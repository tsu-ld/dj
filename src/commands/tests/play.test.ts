import type { PlayRequest } from '../../ports/music.ts'
import { describe, expect, test } from 'bun:test'
import { UserError } from '../../core/errors.ts'
import { MAX_QUEUE_SIZE } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { addSongs, query } from '../play.ts'
import { fakeContext, fakeMusic, fakeUi, log, view } from './fakes.ts'

function collector(requests: PlayRequest[], result: { added: number, first: string | null, dropped?: number }): ReturnType<typeof fakeMusic> {
  return fakeMusic({
    async play(request) {
      requests.push(request)

      return {
        added: result.added,
        first: result.first,
        dropped: result.dropped ?? 0,
      }
    },
  })
}

describe('query', () => {
  test('a link the music capability rejects is refused with its reason', async () => {
    const requests: PlayRequest[] = []
    const music = fakeMusic({
      async play(request) {
        requests.push(request)
        throw new UserError(MESSAGES.unsupportedUrl)
      },
    })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run('query', { query: 'https://example.com/song' }, fakeContext({ services: { music } }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.unsupportedUrl })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.value).toBe('https://example.com/song')
  })

  test('a query plays the search text as an announced request', async () => {
    const requests: PlayRequest[] = []
    const music = collector(requests, { added: 1, first: 'A' })
    const bus = commandBus({ specs: [query], logger: log })
    const ui = fakeUi()
    const context = fakeContext({ services: { music }, ui })

    const outcome = await bus.run('query', { query: 'cumbia' }, context)

    expect(outcome.kind).toBe('ok')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'text', value: 'cumbia', announce: true })
    expect(requests[0]?.member).toBe(context.member)
    expect(requests[0]?.voiceChannel ?? null).toBe(context.voiceChannel)
    expect(ui.replies).toEqual([])
  })

  test('the queue cap confirmation reports kept and total', async () => {
    const ui = fakeUi()
    const music = collector([], { added: 5, first: 'A', dropped: 2 })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run('query', { query: 'playlist' }, fakeContext({ ui, services: { music } }))

    expect(outcome.kind).toBe('ok')
    expect(ui.replies).toEqual([MESSAGES.playlistCapped(3, 5)])
    expect(ui.acks()).toBe(0)
  })

  test('a full queue is refused before joining voice', async () => {
    const requests: PlayRequest[] = []
    const music = collector(requests, { added: 1, first: 'A' })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run('query', { query: 'cumbia' }, fakeContext({ queue: view({ size: MAX_QUEUE_SIZE }), services: { music } }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.queueFull(MAX_QUEUE_SIZE) })
    expect(requests).toEqual([])
  })

  test('a query without a voice channel is refused', async () => {
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run('query', { query: 'cumbia' }, fakeContext({ voiceChannel: null }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.joinVoiceChannel })
  })
})

describe('add_songs', () => {
  test('queues the requested songs without announcing each one', async () => {
    const requests: PlayRequest[] = []
    const music = collector(requests, { added: 2, first: 'A' })
    const bus = commandBus({ specs: [addSongs], logger: log })

    const outcome = await bus.run('add_songs', { songs: [' A ', 'B', 'C'] }, fakeContext({ services: { music } }))

    expect(outcome).toEqual({ kind: 'ok', data: { queued: 2, missing: 1, skipped_for_room: 0, first_added: 'A' } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'tracks', value: ['A', 'B', 'C'], announce: false })
  })

  test('never asks for more than ten songs', async () => {
    const requests: PlayRequest[] = []
    const music = collector(requests, { added: 10, first: 'A' })
    const songs = Array.from({ length: 12 }, (_, index) => `Song ${index + 1}`)

    await addSongs.run({ songs }, fakeContext({ services: { music } }))

    expect(requests[0]?.value).toHaveLength(10)
  })

  test('only asks for the room left in the queue', async () => {
    const requests: PlayRequest[] = []
    const music = collector(requests, { added: 5, first: 'A' })
    const songs = Array.from({ length: 8 }, (_, index) => `Song ${index + 1}`)

    await addSongs.run({ songs }, fakeContext({ queue: view({ size: MAX_QUEUE_SIZE - 5 }), services: { music } }))

    expect(requests[0]?.value).toHaveLength(5)
  })

  test('refuses an empty list, a full queue or a missing voice channel', async () => {
    const music = fakeMusic()
    const bus = commandBus({ specs: [addSongs], logger: log })

    expect(await bus.run('add_songs', { songs: [] }, fakeContext({ services: { music } })))
      .toEqual({ kind: 'refused', message: 'no songs were given' })
    expect(await bus.run('add_songs', { songs: ['a'] }, fakeContext({ queue: view({ size: MAX_QUEUE_SIZE }), services: { music } })))
      .toEqual({ kind: 'refused', message: MESSAGES.queueFull(MAX_QUEUE_SIZE) })
    expect(await bus.run('add_songs', { songs: ['a'] }, fakeContext({ voiceChannel: null, services: { music } })))
      .toEqual({ kind: 'refused', message: MESSAGES.joinVoiceChannel })
    expect(music.calls).not.toContain('play')
  })
})
