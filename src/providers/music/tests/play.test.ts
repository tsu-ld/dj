import type { GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js'
import type { DisTube } from 'distube'
import { expect, test } from 'bun:test'
import { ChannelType } from 'discord.js'
import { keyedQueue } from '../../../core/async.ts'
import { MAX_QUEUE_SIZE } from '../../../limits.ts'
import { MESSAGES } from '../../../messages.ts'
import { MusicCatalog } from '../catalog.ts'
import { musicPlay } from '../play.ts'
import { assertYoutubeUrl } from '../policy.ts'
import { extractionStub, log, memberOf, rejection, streamStub } from './fakes.ts'

function station(resolve: (input: string) => void, queued = 0): { play: ReturnType<typeof musicPlay>, calls: string[] } {
  const calls: string[] = []
  const player = {
    getQueue: () => queued === 0 ? undefined : { songs: Array.from({ length: queued }) },
    async play(_channel: unknown, input: string) {
      calls.push('play')
      resolve(input)
    },
  } as unknown as DisTube
  const play = musicPlay({
    player,
    catalog: new MusicCatalog({ extraction: extractionStub(), stream: streamStub(), logger: log }),
    audio: {
      playWelcome: async () => {
        calls.push('welcome')
      },
    },
    mutations: keyedQueue(),
    logger: log,
  })

  return { play, calls }
}

function request(value: string): Parameters<ReturnType<typeof musicPlay>>[0] {
  const guild = { id: 'g1', members: { me: { voice: null } } }
  const voiceChannel = { type: ChannelType.GuildVoice, guild, permissionsFor: () => ({ has: () => true }) } as unknown as VoiceBasedChannel

  return {
    kind: 'text',
    value,
    member: memberOf('200000000000000001', 'ana'),
    voiceChannel,
    textChannel: {} as unknown as GuildTextBasedChannel,
  }
}

test('a music host the catalog cannot resolve is answered as an unsupported link', async () => {
  const { play, calls } = station(input => assertYoutubeUrl(input))

  expect(await rejection(async () => play(request('https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi')))).toBe(MESSAGES.unsupportedUrl)
  expect(calls).toEqual(['welcome', 'play'])
})

test('a link outside the music hosts is refused before the bot joins', async () => {
  const { play, calls } = station(() => {})

  expect(await rejection(async () => play(request('https://example.com/song.mp3')))).toBe(MESSAGES.unsupportedUrl)
  expect(calls).toEqual([])
})

test('a full queue is refused before the bot joins', async () => {
  const { play, calls } = station(() => {}, MAX_QUEUE_SIZE)

  expect(await rejection(async () => play(request('cumbia')))).toBe(MESSAGES.queueFull(MAX_QUEUE_SIZE))
  expect(calls).toEqual([])
})
