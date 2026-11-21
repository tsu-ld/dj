import type { Client } from 'discord.js'
import type { DisTube } from 'distube'
import type { QueueView } from '../../../ports/music.ts'
import type { AudioEndReason, AudioHealth, AudioHealthSession } from '../audio-health.ts'
import { EventEmitter } from 'node:events'
import { expect, jest, test } from 'bun:test'
import { Events } from 'distube'
import { captureLog, testTrack as track } from '../../../tests/fixtures.ts'
import { audioHealth } from '../audio-health.ts'
import { createEmitter } from '../emitter.ts'
import { musicEvents } from '../events.ts'

class FakeStream extends EventEmitter {
  killed = 0

  kill(): void {
    this.killed += 1
  }
}

class FakeVoice extends EventEmitter {
  stream: FakeStream
  readonly connection = { ping: { ws: 44 as number | undefined, udp: 58 as number | undefined } }

  constructor(stream: FakeStream) {
    super()
    this.stream = stream
  }
}

interface FakeQueue {
  readonly id: string
  readonly songs: Array<{
    readonly id: string
    readonly name: string
    readonly stream: { playFromSource: boolean }
  }>
  readonly textChannel: null
  readonly voice: FakeVoice
}

function fakeQueue(stream: FakeStream): FakeQueue {
  return {
    id: 'g1',
    songs: [{ id: 'song-1', name: 'Song 1', stream: { playFromSource: true } }],
    textChannel: null,
    voice: new FakeVoice(stream),
  }
}

function fakePlayer(queue: FakeQueue) {
  const bus = new EventEmitter()
  const player = {
    on(event: string, listener: (...args: Array<never>) => void) {
      bus.on(event, listener as (...args: Array<unknown>) => void)

      return player
    },
    off(event: string, listener: (...args: Array<never>) => void) {
      bus.off(event, listener as (...args: Array<unknown>) => void)

      return player
    },
    emit(event: string, ...args: Array<unknown>) {
      return bus.emit(event, ...args)
    },
    getQueue: () => queue,
    queues: { collection: new Map<string, unknown>() },
    voices: { get: () => undefined, collection: new Map<string, unknown>() },
  }

  return player
}

function fakeHealth() {
  const started: Array<AudioHealthSession> = []
  const ended: Array<{ guildId: string; reason: AudioEndReason }> = []
  const health: AudioHealth = {
    start(session) {
      started.push(session)
    },
    end(guildId, reason) {
      ended.push({ guildId, reason })
    },
    dispose() {},
  }

  return { health, started, ended }
}

function wiring(player: ReturnType<typeof fakePlayer>, realHealth?: AudioHealth) {
  const log = captureLog()
  const { emitter } = createEmitter()
  const failures: Array<string> = []
  const failedSongs: Array<string | null> = []
  const { health, started, ended } = fakeHealth()

  emitter.on('playbackError', ({ guildId, songId }) => {
    failures.push(guildId)
    failedSongs.push(songId)
  })

  const events = musicEvents({
    player: player as unknown as DisTube,
    client: { on: () => {}, off: () => {} } as unknown as Client,
    catalog: {
      trackOf: (value: { id: string; name?: string }) =>
        track({ id: value.id, title: value.name ?? value.id }),
    } as never,
    cache: { prefetch: () => {} } as never,
    emitter,
    forgetStream: () => {},
    leave: () => {},
    viewOf: () => ({}) as QueueView,
    health: realHealth ?? health,
    logger: log.logger,
  })

  return {
    events,
    emitter,
    log,
    failures,
    failedSongs,
    started,
    ended,
    has: (event: string): boolean => log.events.includes(event),
    orphans: (): number => log.entries('music.orphan_stream_failed').length,
  }
}

function ffmpegExited(): Error {
  const error = new Error('ffmpeg exited with code 8')

  error.name = 'DisTubeError [FFMPEG_EXITED]'

  return error
}

function play(queue: FakeQueue, player: ReturnType<typeof fakePlayer>) {
  player.emit(Events.PLAY_SONG, queue, queue.songs[0])
}

test('an ffmpeg exit that lost its listener is logged, not reported twice, and never crashes', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(player)

  let engineSaw = 0
  const engineHandler = (): void => {
    engineSaw += 1
  }

  stream.on('error', engineHandler)
  play(queue, player)

  queue.voice.stream = new FakeStream()
  stream.off('error', engineHandler)

  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(engineSaw).toBe(0)

  expect(harness.log.entries('music.orphan_stream_failed')[0]).toMatchObject({ level: 'warn' })
  expect(harness.failures).toEqual([])
  expect(harness.has('music.playback_error')).toBe(false)
  expect(harness.ended).toEqual([])
  expect(stream.killed).toBe(1)
})

test('an orphan error leaves the song now playing with its session running', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(player)

  play(queue, player)
  queue.voice.stream = new FakeStream()

  stream.emit('error', ffmpegExited())
  player.emit(Events.FINISH_SONG, queue, queue.songs[0])

  expect(harness.started.map((session) => session.guildId)).toEqual(['g1'])
  expect(harness.ended).toEqual([{ guildId: 'g1', reason: 'finished' }])
})

test('an error on the stream the engine still listens to is not reported twice', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(player)

  let engineSaw = 0

  stream.on('error', () => {
    engineSaw += 1
  })
  play(queue, player)

  stream.emit('error', ffmpegExited())

  expect(engineSaw).toBe(1)
  expect(harness.failures).toEqual([])
  expect(harness.has('music.playback_error')).toBe(false)
})

test('a stop clears the session, so the sample timer stops without a skip', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const now = 0
  const captured = captureLog()
  const health = audioHealth({
    clock: { now: () => now },
    logger: captured.logger,
  })
  const harness = wiring(player, health)

  jest.useFakeTimers()

  try {
    expect(jest.getTimerCount()).toBe(0)
    play(queue, player)
    expect(jest.getTimerCount()).toBe(1)

    harness.emitter.emit('queueCleared', { guildId: 'g1', resetStation: true })

    expect(jest.getTimerCount()).toBe(0)
    expect(captured.entries('music.audio_health')).toEqual([
      expect.objectContaining({ reason: 'stopped' }),
    ])
  } finally {
    health.dispose()
    jest.useRealTimers()
  }
})

test('a finished, cleared or disconnected queue prunes its streams but keeps listening', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(player)

  play(queue, player)
  expect(stream.listenerCount('error')).toBe(1)

  player.emit(Events.FINISH, queue)
  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.orphans()).toBe(1)
  expect(harness.failures).toEqual([])

  expect(stream.listenerCount('error')).toBe(1)

  play(queue, player)
  harness.emitter.emit('queueCleared', { guildId: 'g1', resetStation: false })
  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.orphans()).toBe(2)
  expect(stream.listenerCount('error')).toBe(1)

  play(queue, player)
  player.emit(Events.DISCONNECT, queue)
  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.orphans()).toBe(3)
  expect(stream.listenerCount('error')).toBe(1)
})

test('a playback error names the song that failed', () => {
  const queue = fakeQueue(new FakeStream())
  const player = fakePlayer(queue)
  const harness = wiring(player)

  play(queue, player)
  player.emit(Events.ERROR, new Error('boom'), queue, { id: 'song-2' })
  player.emit(Events.ERROR, new Error('boom'), queue, undefined)

  expect(harness.failedSongs).toEqual(['song-2', 'song-1'])
})

test('a playback error before any song started names none', () => {
  const queue = fakeQueue(new FakeStream())
  const player = fakePlayer(queue)
  const harness = wiring(player)

  player.emit(Events.ERROR, new Error('boom'), queue, undefined)

  expect(harness.failedSongs).toEqual([null])
})

test('a voice error after the engine dropped its listeners is logged, never thrown', () => {
  const queue = fakeQueue(new FakeStream())
  const player = fakePlayer(queue)
  const harness = wiring(player)

  play(queue, player)
  play(queue, player)
  expect(queue.voice.listenerCount('error')).toBe(1)

  expect(() => queue.voice.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.log.entries('music.voice_error')[0]).toMatchObject({ level: 'warn' })
  expect(harness.failures).toEqual([])
})

test('a finished song logs its audio summary, with the ping the connection reports', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(player)

  play(queue, player)
  expect(harness.started).toHaveLength(1)
  expect(harness.started[0]?.guildId).toBe('g1')
  expect(harness.started[0]?.title).toBe('Song 1')
  expect(harness.started[0]?.ping()).toEqual({ ws: 44, udp: 58 })

  player.emit(Events.FINISH_SONG, queue, queue.songs[0])

  expect(harness.ended).toEqual([{ guildId: 'g1', reason: 'finished' }])
})
