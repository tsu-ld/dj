import type { DisTube } from 'distube'
import type { MusicEventMap } from '../../../ports/music.ts'
import { pathToFileURL } from 'node:url'
import { AudioPlayerStatus } from '@discordjs/voice'
import { expect, test } from 'bun:test'
import { ChannelType } from 'discord.js'
import { keyedQueue } from '../../../core/async.ts'
import { isPositionInQueue, MAX_QUEUE_SIZE, queueRoom } from '../../../limits.ts'
import { MESSAGES } from '../../../messages.ts'
import { MusicCatalog } from '../catalog.ts'
import { musicControls } from '../controls.ts'
import { createEmitter } from '../emitter.ts'
import {
  capQueue,
  clearStation,
  queueView,
  removeSongAt,
  shouldCleanupAfterError,
  skipSong,
} from '../queue.ts'
import { voiceChannelProblem } from '../voice.ts'
import { extractionStub, log, memberOf, rejection, streamStub, track } from './fakes.ts'

test('queue positions are one-based and bounded by the queue', () => {
  expect(isPositionInQueue(2, 1)).toBe(true)
  expect(isPositionInQueue(2, 2)).toBe(true)
  expect(isPositionInQueue(2, 0)).toBe(false)
  expect(isPositionInQueue(2, 3)).toBe(false)
})

test('queue room is what remains under the cap', () => {
  expect(queueRoom(0)).toBe(200)
  expect(queueRoom(197)).toBe(3)
  expect(queueRoom(200)).toBe(0)
  expect(queueRoom(250)).toBe(0)
})

test('the queue is capped after the current song and reports what it dropped', () => {
  const names = Array.from({ length: MAX_QUEUE_SIZE + 1 }, (_, index) => `song-${index}`)
  const queue = { songs: names.map(name => ({ name })) }

  expect(capQueue(queue)).toBe(1)
  expect(queue.songs.map(song => song.name)).toEqual(names.slice(0, MAX_QUEUE_SIZE))
})

test('a queue under the cap is left untouched', () => {
  const queue = { songs: Array.from({ length: MAX_QUEUE_SIZE - 1 }, (_, index) => ({ name: `song-${index}` })) }

  expect(capQueue(queue)).toBe(0)
  expect(queue.songs).toHaveLength(MAX_QUEUE_SIZE - 1)
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

function skipStation(): {
  controls: ReturnType<typeof musicControls>
  order: string[]
  skipped: Array<MusicEventMap['trackSkipped']>
} {
  const catalog = new MusicCatalog({ extraction: extractionStub(), stream: streamStub(), logger: log })
  const songs = [
    catalog.buildSong({ id: 'a', title: 'A', artist: 'Soda Stereo' }, { member: memberOf('200000000000000007', 'tsu') }),
    catalog.buildSong({ id: 'b', title: 'B' }, {}),
    catalog.buildSong({ id: 'c', title: 'C' }, {}),
  ]
  const order: string[] = []
  const skipped: Array<MusicEventMap['trackSkipped']> = []
  const queue = {
    id: 'guild-1',
    songs,
    autoplay: false,
    paused: false,
    textChannel: undefined,
    async skip() {
      order.push('skip')
      songs.shift()
    },
  }
  const voice = { audioPlayer: { state: { status: AudioPlayerStatus.Playing, playbackDuration: 42_000 } }, leave() {} }
  const player = { getQueue: () => queue, voices: { get: () => voice } } as unknown as DisTube
  const { emitter } = createEmitter()

  emitter.on('trackSkipped', (payload) => {
    order.push('trackSkipped')
    skipped.push(payload)
  })

  const controls = musicControls({
    player,
    catalog,
    mutations: keyedQueue(),
    emitter,
    viewOf: current => queueView(current, song => catalog.trackOf(song)),
    streamReplaced: () => {},
  })

  return { controls, order, skipped }
}

function seekStation(options: { status?: AudioPlayerStatus, isLive?: boolean, duration?: number, copyDuration?: number, url?: string } = {}): {
  controls: ReturnType<typeof musicControls>
  seeks: number[]
  order: string[]
  setPlaybackTime: (seconds: number) => void
} {
  const catalog = new MusicCatalog({ extraction: extractionStub(), stream: streamStub(), logger: log })
  const song = catalog.buildSong({ id: 'a', title: 'A', duration: options.duration ?? 200, is_live: options.isLive ?? false }, {})
  const url = options.url ?? 'https://rr1.googlevideo.com/videoplayback?id=a'

  // a Spotify song plays the YouTube copy the engine found for it
  if (options.copyDuration === undefined) {
    song.stream = { playFromSource: true, url }
  }
  else {
    const copy = catalog.buildSong({ id: 'yt', title: 'A', duration: options.copyDuration }, {})

    copy.stream = { playFromSource: true, url }
    song.stream = { playFromSource: false, song: copy }
  }

  const seeks: number[] = []
  const order: string[] = []
  const queue = {
    id: 'guild-1',
    songs: [song],
    autoplay: false,
    paused: false,
    textChannel: undefined,
    async seek(time: number) {
      seeks.push(time)
      order.push('seek')
    },
  }
  const voice = {
    audioPlayer: { state: { status: options.status ?? AudioPlayerStatus.Playing, playbackDuration: 5_000 } },
    playbackTime: 5,
    leave() {},
  }
  const player = { getQueue: () => queue, voices: { get: () => voice } } as unknown as DisTube
  const { emitter } = createEmitter()

  emitter.on('stateChanged', () => order.push('stateChanged'))

  const controls = musicControls({
    player,
    catalog,
    mutations: keyedQueue(),
    emitter,
    viewOf: current => queueView(current, item => catalog.trackOf(item)),
    streamReplaced: () => order.push('streamReplaced'),
  })

  return {
    controls,
    seeks,
    order,
    setPlaybackTime: (seconds) => {
      voice.playbackTime = seconds
    },
  }
}

test('a seek jumps the playing song, watches its new stream and redraws the card', async () => {
  const { controls, seeks, order } = seekStation()

  await controls.seek('guild-1', 'a', 80)

  expect(seeks).toEqual([80])
  expect(order).toEqual(['seek', 'streamReplaced', 'stateChanged'])
})

test('a seek stays inside the song', async () => {
  const { controls, seeks } = seekStation()

  await controls.seek('guild-1', 'a', 500)
  await controls.seek('guild-1', 'a', -3)

  expect(seeks).toEqual([199, 0])
})

test('a song playing from a cached file that is still there seeks', async () => {
  const { controls, seeks } = seekStation({ url: pathToFileURL(import.meta.path).href })

  await controls.seek('guild-1', 'a', 40)

  expect(seeks).toEqual([40])
})

test('a seek stays inside the copy a Spotify song plays', async () => {
  const { controls, seeks } = seekStation({ duration: 300, copyDuration: 210 })

  await controls.seek('guild-1', 'a', 240)

  expect(seeks).toEqual([209])
})

test('a seek drawn for a song that already ended does not move the next one', async () => {
  const { controls, seeks } = seekStation()

  expect(await rejection(async () => controls.seek('guild-1', 'gone', 40))).toBe(MESSAGES.seekStale)
  expect(seeks).toEqual([])
})

test('only a song that is playing seeks: not one buffering, paused, live or of unknown length', async () => {
  const stations = [
    seekStation({ status: AudioPlayerStatus.Idle }),
    seekStation({ status: AudioPlayerStatus.Buffering }),
    seekStation({ status: AudioPlayerStatus.Paused }),
    seekStation({ isLive: true }),
    seekStation({ duration: 0 }),
    seekStation({ url: 'file:///nonexistent/dj-audio/a.mp4' }),
  ]

  for (const station of stations) {
    expect(await rejection(async () => station.controls.seek('guild-1', 'a', 40))).toBe(MESSAGES.seekUnavailable)
    expect(station.seeks).toEqual([])
  }
})

test('the elapsed time counts from where the song was sought to', () => {
  const { controls, setPlaybackTime } = seekStation()

  setPlaybackTime(85.4)

  expect(controls.status('guild-1')).toEqual({ state: 'playing', playbackDurationMs: 85_400 })
})

test('a song still buffering after a seek reports where it will start', () => {
  const { controls, setPlaybackTime } = seekStation({ status: AudioPlayerStatus.Buffering })

  setPlaybackTime(80)

  expect(controls.status('guild-1')).toEqual({ state: 'idle', playbackDurationMs: 80_000 })
})

const listener = { id: '200000000000000008', name: 'ana' }

test('a skip reports who skipped the playing song, before skipping', async () => {
  const { controls, order, skipped } = skipStation()

  await controls.skip('guild-1', listener)

  expect(order).toEqual(['trackSkipped', 'skip'])
  expect(skipped).toHaveLength(1)
  expect(skipped[0]?.guildId).toBe('guild-1')
  expect(skipped[0]?.by).toEqual(listener)
  expect(skipped[0]?.track.id).toBe('a')
  expect(skipped[0]?.track.artist).toBe('Soda Stereo')
  expect(skipped[0]?.track.requesterId).toBe('200000000000000007')
})

test('removing the playing song reports a skip; removing a waiting song does not', async () => {
  const { controls, order, skipped } = skipStation()

  expect(await controls.remove('guild-1', 2, listener)).toBe('B')
  expect(skipped).toHaveLength(0)

  expect(await controls.remove('guild-1', 1, listener)).toBe('A')
  expect(order).toEqual(['trackSkipped', 'skip'])
  expect(skipped.map(event => [event.track.id, event.by.name])).toEqual([['a', 'ana']])
})

const guild = { members: { me: { id: 'bot' } } }

function voiceChannel({ type = ChannelType.GuildVoice, permissions = { has: () => true } }: {
  type?: ChannelType
  permissions?: { has: (permission: readonly bigint[]) => boolean } | null
} = {}): { type: ChannelType, guild: typeof guild, permissionsFor: () => typeof permissions } {
  return { type, guild, permissionsFor: () => permissions }
}

test('playing without a voice channel is rejected', () => {
  expect(voiceChannelProblem(null)).toBe(MESSAGES.joinVoiceChannel)
})

test('a stage channel needs speaker permission', () => {
  expect(voiceChannelProblem(voiceChannel({ type: ChannelType.GuildStageVoice }))).toBe(MESSAGES.stageChannelPermissions)
})

test('a channel where the bot cannot connect and speak is rejected', () => {
  expect(voiceChannelProblem(voiceChannel({ permissions: { has: () => false } }))).toBe(MESSAGES.botPermissions)
  expect(voiceChannelProblem(voiceChannel({ permissions: null }))).toBe(MESSAGES.botPermissions)
})

test('a regular voice channel with permissions is fine', () => {
  expect(voiceChannelProblem(voiceChannel())).toBeNull()
})

test('the guild defaults to the voice channel guild', () => {
  const channel = { ...voiceChannel(), guild }

  expect(voiceChannelProblem(channel)).toBeNull()
})
