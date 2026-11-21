import type { PlayRequest, PlayResult } from '../../ports/music.ts'
import { describe, expect, jest, test } from 'bun:test'
import { UserError } from '../../core/errors.ts'
import { MAX_QUEUE_SIZE } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import {
  captureLog,
  collector,
  fakeContext,
  fakeMusic,
  fakeTextChannel,
  fakeUi,
  silentLog as log,
  testView as view,
} from '../../tests/fixtures.ts'
import { commandBus } from '../bus.ts'
import { addSongs, query } from '../play.ts'
import { voiceContext } from './fakes.ts'

interface TypingQuery {
  readonly typing: () => number
  readonly finish: (result: PlayResult) => void
  readonly running: Promise<unknown>
}

async function withTypingQuery(check: (query: TypingQuery) => Promise<void>): Promise<void> {
  jest.useFakeTimers()

  try {
    const played = Promise.withResolvers<PlayResult>()
    const { channel: textChannel, typing } = fakeTextChannel()
    const music = fakeMusic({ play: async () => played.promise })
    const bus = commandBus({ specs: [query], logger: log })
    const running = bus.run(
      'query',
      { query: 'cumbia' },
      fakeContext({ textChannel, services: { music } }),
    )

    await check({ typing: () => typing.count, finish: played.resolve, running })
  } finally {
    jest.useRealTimers()
  }
}

describe('query', () => {
  test('a link the music capability rejects is refused with its reason', async () => {
    const requests: Array<PlayRequest> = []
    const music = fakeMusic({
      async play(request) {
        requests.push(request)
        throw new UserError(MESSAGES.unsupportedUrl)
      },
    })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run(
      'query',
      { query: 'https://example.com/song' },
      fakeContext({ services: { music } }),
    )

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.unsupportedUrl })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.value).toBe('https://example.com/song')
  })

  test('a query plays the search text', async () => {
    const requests: Array<PlayRequest> = []
    const music = collector(requests, { added: 1, first: 'A' })
    const bus = commandBus({ specs: [query], logger: log })
    const ui = fakeUi()
    const context = fakeContext({ services: { music }, ui })

    const outcome = await bus.run('query', { query: 'cumbia' }, context)

    expect(outcome.kind).toBe('ok')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'text', value: 'cumbia' })
    expect(requests[0]?.member).toBe(context.member)
    expect(requests[0]?.voiceChannel ?? null).toBe(context.voiceChannel)
    expect(ui.replies).toEqual([])
  })

  test('a query shows a typing indicator before searching', async () => {
    const events: Array<string> = []
    const textChannel = Object.assign(fakeTextChannel().channel, {
      async sendTyping() {
        events.push('typing')
      },
    })
    const music = fakeMusic({
      async play() {
        events.push('play')

        return { added: 1, first: 'A', dropped: 0 }
      },
    })
    const bus = commandBus({ specs: [query], logger: log })

    await bus.run('query', { query: 'cumbia' }, fakeContext({ textChannel, services: { music } }))

    expect(events).toEqual(['typing', 'play'])
  })

  test('a query still searches when the typing indicator fails', async () => {
    let played = false
    const textChannel = fakeTextChannel({ failTyping: true }).channel
    const music = fakeMusic({
      async play() {
        played = true

        return { added: 1, first: 'A', dropped: 0 }
      },
    })
    const logs = captureLog()
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run(
      'query',
      { query: 'cumbia' },
      fakeContext({ textChannel, services: { music, logger: logs.logger } }),
    )

    expect(outcome.kind).toBe('ok')
    expect(played).toBe(true)
    expect(logs.entries('command.typing_failed')).toMatchObject([
      { level: 'debug', error: 'typing failed' },
    ])
  })

  test('a query keeps refreshing the typing indicator until it finishes', async () => {
    await withTypingQuery(async ({ typing, finish, running }) => {
      expect(typing()).toBe(1)

      jest.advanceTimersByTime(8000)
      expect(typing()).toBe(2)

      finish({ added: 1, first: 'A', dropped: 0 })
      await running

      jest.advanceTimersByTime(8000)
      expect(typing()).toBe(2)
    })
  })

  test('a query stops refreshing the typing indicator after a minute', async () => {
    await withTypingQuery(async ({ typing, finish, running }) => {
      expect(typing()).toBe(1)

      jest.advanceTimersByTime(60_000)
      expect(typing()).toBe(8)

      jest.advanceTimersByTime(8000)
      expect(typing()).toBe(8)

      finish({ added: 1, first: 'A', dropped: 0 })
      await running
    })
  })

  test('the queue cap confirmation reports kept and total', async () => {
    const ui = fakeUi()
    const music = collector([], { added: 5, first: 'A', dropped: 2 })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run(
      'query',
      { query: 'playlist' },
      fakeContext({ ui, services: { music } }),
    )

    expect(outcome.kind).toBe('ok')
    expect(ui.replies).toEqual([MESSAGES.playlistCapped(3, 5)])
    expect(ui.acks()).toBe(0)
  })

  test("a full queue the music engine finds at the request's turn reaches the listener", async () => {
    const requests: Array<PlayRequest> = []
    const music = fakeMusic({
      async play(request) {
        requests.push(request)
        throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))
      },
    })
    const ui = fakeUi()
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run(
      'query',
      { query: 'cumbia' },
      fakeContext({ ui, services: { music } }),
    )

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.queueFull(MAX_QUEUE_SIZE) })
    expect(requests).toHaveLength(1)
    expect(ui.errors).toEqual([MESSAGES.queueFull(MAX_QUEUE_SIZE)])
  })

  test('a query whose text is not a string fails instead of searching', async () => {
    const requests: Array<PlayRequest> = []
    const music = collector(requests)
    const ui = fakeUi()
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run('query', { query: 42 }, fakeContext({ ui, services: { music } }))

    expect(outcome.kind).toBe('failed')
    expect(requests).toEqual([])
    expect(ui.errors).toEqual([MESSAGES.genericError])
  })

  test('a full queue is refused before joining voice', async () => {
    const requests: Array<PlayRequest> = []
    const music = collector(requests, {}, { view: () => view({ size: MAX_QUEUE_SIZE }) })
    const bus = commandBus({ specs: [query], logger: log })

    const outcome = await bus.run(
      'query',
      { query: 'cumbia' },
      fakeContext({ services: { music } }),
    )

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
    const requests: Array<PlayRequest> = []
    const music = collector(requests, { added: 2, first: 'A' })
    const bus = commandBus({ specs: [addSongs], logger: log })

    const outcome = await bus.run(
      'add_songs',
      { songs: [' A ', 'B', 'C'] },
      fakeContext({ services: { music } }),
    )

    expect(outcome).toEqual({
      kind: 'ok',
      data: { queued: 2, missing: 1, skipped_for_room: 0, first_added: 'A' },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'tracks', value: ['A', 'B', 'C'] })
  })

  test('never asks for more than ten songs', async () => {
    const requests: Array<PlayRequest> = []
    const music = collector(requests, { added: 10, first: 'A' })
    const songs = Array.from({ length: 12 }, (_, index) => `Song ${index + 1}`)

    await addSongs.run({ songs }, voiceContext({ services: { music } }))

    expect(requests[0]?.value).toHaveLength(10)
  })

  test('only asks for the room left in the queue', async () => {
    const requests: Array<PlayRequest> = []
    const music = collector(
      requests,
      { added: 5, first: 'A' },
      { view: () => view({ size: MAX_QUEUE_SIZE - 5 }) },
    )
    const songs = Array.from({ length: 8 }, (_, index) => `Song ${index + 1}`)

    await addSongs.run({ songs }, voiceContext({ services: { music } }))

    expect(requests[0]?.value).toHaveLength(5)
  })

  test('refuses an empty list, a full queue or a missing voice channel', async () => {
    const music = fakeMusic()
    const full = fakeMusic({ view: () => view({ size: MAX_QUEUE_SIZE }) })
    const bus = commandBus({ specs: [addSongs], logger: log })

    expect(await bus.run('add_songs', { songs: [] }, fakeContext({ services: { music } }))).toEqual(
      { kind: 'refused', message: 'no songs were given' },
    )
    expect(
      await bus.run('add_songs', { songs: ['a'] }, fakeContext({ services: { music: full } })),
    ).toEqual({ kind: 'refused', message: MESSAGES.queueFull(MAX_QUEUE_SIZE) })
    expect(
      await bus.run(
        'add_songs',
        { songs: ['a'] },
        fakeContext({ voiceChannel: null, services: { music } }),
      ),
    ).toEqual({ kind: 'refused', message: MESSAGES.joinVoiceChannel })
    expect(music.calls).not.toContain('play')
    expect(full.calls).not.toContain('play')
  })
})
