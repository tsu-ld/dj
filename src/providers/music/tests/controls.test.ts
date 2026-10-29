import type { MusicEventMap } from '../../../ports/music.ts'
import { expect, test } from 'bun:test'
import { ChannelType } from 'discord.js'
import { MESSAGES } from '../../../messages.ts'
import {
  announcesAdd,
  capQueue,
  clearStation,
  isPositionInQueue,
  queueRoom,
  queueView,
  removeSongAt,
  shouldCleanupAfterError,
  skipSong,
} from '../queue.ts'
import { voiceChannelProblem } from '../voice.ts'
import { rejection, track } from './helpers.ts'

test('queue positions are one-based and bounded by the queue', () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }] }

  expect(isPositionInQueue(queue, 1)).toBe(true)
  expect(isPositionInQueue(queue, 2)).toBe(true)
  expect(isPositionInQueue(queue, 0)).toBe(false)
  expect(isPositionInQueue(queue, 3)).toBe(false)
})

test('queue room is what remains under the cap', () => {
  expect(queueRoom(null)).toBe(200)
  expect(queueRoom({ songs: [] })).toBe(200)
  expect(queueRoom({ songs: [{}, {}, {}] }, 5)).toBe(2)
  expect(queueRoom({ songs: [{}, {}] }, 1)).toBe(0)
})

test('the queue is capped after the current song and reports what it dropped', () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }

  expect(capQueue(queue, 3)).toBe(1)
  expect(queue.songs.map(song => song.name)).toEqual(['a', 'b', 'c'])
})

test('a queue under the cap is left untouched', () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }] }

  expect(capQueue(queue, 3)).toBe(0)
  expect(queue.songs).toHaveLength(2)
})

test('removing a song keeps the rest of the queue in order', async () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }
  let skipped = false

  await removeSongAt(queue, 2, async () => {
    skipped = true
  })

  expect(skipped).toBe(false)
  expect(queue.songs.map(song => song.name)).toEqual(['a', 'c'])
})

test('removing the current song skips it instead of splicing', async () => {
  let skipped = false
  const queue = {
    songs: [{ name: 'a' }, { name: 'b' }],
    autoplay: false,
    skip: async () => {},
  }

  await removeSongAt(queue, 1, async () => {
    skipped = true
  })

  expect(skipped).toBe(true)
  expect(queue.songs).toHaveLength(2)
})

test('skipping the last song clears the queue instead of sitting on it', async () => {
  let cleared = false
  const queue = {
    songs: [{ name: 'a' }],
    autoplay: false,
    skip: async () => {},
  }

  await skipSong(queue, async () => {
    cleared = true
  })

  expect(cleared).toBe(true)
})

test('radio without a related song clears the queue instead of throwing', async () => {
  let cleared = false
  const queue = {
    songs: [{ name: 'a' }],
    autoplay: true,
    skip: async () => {
      throw Object.assign(new Error('no related song'), { errorCode: 'NO_RELATED' })
    },
  }

  await skipSong(queue, async () => {
    cleared = true
  })

  expect(cleared).toBe(true)
})

test('an unknown skip failure is not swallowed', async () => {
  const queue = {
    songs: [{ name: 'a' }, { name: 'b' }],
    autoplay: false,
    skip: async () => {
      throw new Error('boom')
    },
  }

  expect(await rejection(async () => skipSong(queue, async () => {}))).toBe('boom')
})

test('a briefly empty queue is left alone', async () => {
  let cleared = false
  const queue = {
    songs: [],
    autoplay: false,
    skip: async () => {},
  }

  await skipSong(queue, async () => {
    cleared = true
  })

  expect(cleared).toBe(false)
})

test('the view maps the current song, every upcoming song and the queue state', () => {
  const view = queueView(
    {
      songs: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      paused: true,
      autoplay: true,
    },
    song => track({ id: song.id, title: song.id, fromRadio: song.id === 'c' }),
  )

  expect(view.current?.id).toBe('a')
  expect(view.upcoming.map(song => song.id)).toEqual(['b', 'c'])
  expect(view.upcoming[1]?.fromRadio).toBe(true)
  expect(view.size).toBe(3)
  expect(view.paused).toBe(true)
  expect(view.radio).toBe(true)
})

test('an empty queue has no current song', () => {
  const view = queueView({ songs: [], paused: false, autoplay: false }, () => track())

  expect(view).toEqual({ current: null, upcoming: [], paused: false, radio: false, size: 0 })
})

test('autoplay additions never announce, even during an announced request', () => {
  const request = { announce: true }

  expect(announcesAdd(request, track())).toBe(true)
  expect(announcesAdd(request, track({ fromRadio: true }))).toBe(false)
  expect(announcesAdd({ announce: false }, track())).toBe(false)
  expect(announcesAdd(undefined, track())).toBe(false)
})

test('an explicit stop reports whether the station resets', async () => {
  const seen: Array<MusicEventMap['queueCleared']> = []
  const order: string[] = []
  const queue = {
    id: 'guild-1',
    stop: async () => {
      order.push('stop')
    },
  }

  await clearStation(queue, () => order.push('leave'), payload => seen.push(payload), true)
  await clearStation(queue, () => order.push('leave'), payload => seen.push(payload), false)

  expect(order).toEqual(['stop', 'leave', 'stop', 'leave'])
  expect(seen).toEqual([
    { guildId: 'guild-1', resetStation: true },
    { guildId: 'guild-1', resetStation: false },
  ])
})

test('cleanup only runs when the failed song left the live queue empty', () => {
  const queue = { songs: [] }

  expect(shouldCleanupAfterError(queue, queue)).toBe(true)
  expect(shouldCleanupAfterError({ songs: [{ name: 'next' }] }, queue)).toBe(false)
  expect(shouldCleanupAfterError(queue, { songs: [] })).toBe(false)
  expect(shouldCleanupAfterError(queue, undefined)).toBe(false)
})

const guild = { members: { me: { id: 'bot' } } }

function voiceChannel({ type = ChannelType.GuildVoice, permissions = { has: () => true } }: {
  type?: ChannelType
  permissions?: { has: (permission: readonly bigint[]) => boolean } | null
} = {}): { type: ChannelType, permissionsFor: () => typeof permissions } {
  return { type, permissionsFor: () => permissions }
}

test('playing without a voice channel is rejected', () => {
  expect(voiceChannelProblem(null, guild)).toBe(MESSAGES.joinVoiceChannel)
})

test('a stage channel needs speaker permission', () => {
  expect(voiceChannelProblem(voiceChannel({ type: ChannelType.GuildStageVoice }), guild)).toBe(MESSAGES.stageChannelPermissions)
})

test('a channel where the bot cannot connect and speak is rejected', () => {
  expect(voiceChannelProblem(voiceChannel({ permissions: { has: () => false } }), guild)).toBe(MESSAGES.botPermissions)
  expect(voiceChannelProblem(voiceChannel({ permissions: null }), guild)).toBe(MESSAGES.botPermissions)
})

test('a regular voice channel with permissions is fine', () => {
  expect(voiceChannelProblem(voiceChannel(), guild)).toBeNull()
})

test('the guild defaults to the voice channel guild', () => {
  const channel = { ...voiceChannel(), guild }

  expect(voiceChannelProblem(channel)).toBeNull()
})
