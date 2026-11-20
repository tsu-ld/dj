import type { Client } from 'discord.js'
import type { DisTube } from 'distube'
import type { Logger } from '../../../core/logger.ts'
import type { QueueView } from '../../../ports/music.ts'
import type { AudioEndReason, AudioHealth, AudioHealthSession } from '../audio-health.ts'
import { EventEmitter } from 'node:events'
import { expect, test } from 'bun:test'
import { Events } from 'distube'
import { logger } from '../../../core/logger.ts'
import { audioHealth } from '../audio-health.ts'
import { createEmitter } from '../emitter.ts'
import { currentForStream, musicEvents } from '../events.ts'
import { track } from './fakes.ts'

interface FakeSong {
  id: string
  stream: { playFromSource: boolean }
}

function song(id: string, playFromSource: boolean): FakeSong {
  return { id, stream: { playFromSource } }
}

test('the line belongs to the card, not to the stream resolved behind it', () => {
  const card = song('spotify', false)
  const resolved = song('youtube', true)

  expect(currentForStream(resolved, { songs: [card] })).toBe(card)
  expect(currentForStream(card, { songs: [card] })).toBe(card)
})

test('a stream resolved for another song stays silent', () => {
  const other = song('other', true)
  const current = song('current', true)

  expect(currentForStream(other, { songs: [current] })).toBeNull()
  expect(currentForStream(other, null)).toBeNull()
  expect(currentForStream(other, { songs: [] })).toBeNull()
})

class FakeStream extends EventEmitter {
  killed = 0

  kill(): void {
    this.killed += 1
  }
}

// The engine's voice: an emitter that re-emits its stream's errors.
class FakeVoice extends EventEmitter {
  constructor(public stream: FakeStream, readonly connection = { ping: { ws: 44 as number | undefined, udp: 58 as number | undefined } }) {
    super()
  }
}

interface FakeQueue {
  readonly id: string
  readonly songs: Array<{ readonly id: string, readonly name: string, readonly stream: { playFromSource: boolean } }>
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

// The parts of the engine the event wiring reads, with the same event names.
function fakePlayer(queue: FakeQueue) {
  const bus = new EventEmitter()
  const player = {
    on(event: string, listener: (...args: never[]) => void) {
      bus.on(event, listener as (...args: unknown[]) => void)

      return player
    },
    off(event: string, listener: (...args: never[]) => void) {
      bus.off(event, listener as (...args: unknown[]) => void)

      return player
    },
    emit(event: string, ...args: unknown[]) {
      return bus.emit(event, ...args)
    },
    getQueue: () => queue,
    queues: { collection: new Map<string, unknown>() },
    voices: { get: () => undefined, collection: new Map<string, unknown>() },
  }

  return player
}

function fakeHealth() {
  const started: AudioHealthSession[] = []
  const ended: Array<{ guildId: string, reason: AudioEndReason }> = []
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

function wiring(queue: FakeQueue, player: ReturnType<typeof fakePlayer>, realHealth?: AudioHealth) {
  const lines: Array<{ event: string, fields: Record<string, unknown> }> = []
  const log: Logger = logger({
    level: 'debug',
    sink(line) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      lines.push({ event: String(parsed.event), fields: parsed })
    },
  })
  const { emitter } = createEmitter()
  const failures: string[] = []
  const failedSongs: Array<string | null> = []
  const { health, started, ended } = fakeHealth()

  emitter.on('playbackError', ({ guildId, songId }) => {
    failures.push(guildId)
    failedSongs.push(songId)
  })

  const events = musicEvents({
    player: player as unknown as DisTube,
    client: { on: () => {}, off: () => {} } as unknown as Client,
    catalog: { trackOf: (value: { id: string, name?: string }) => track({ id: value.id, title: value.name ?? value.id }) } as never,
    cache: { prefetch: () => {} } as never,
    emitter,
    beforeStream: async () => {},
    forgetStream: () => {},
    leave: () => {},
    viewOf: () => ({}) as QueueView,
    health: realHealth ?? health,
    logger: log,
  })

  return {
    events,
    emitter,
    lines,
    failures,
    failedSongs,
    started,
    ended,
    has: (event: string): boolean => lines.some(line => line.event === event),
    orphans: (): number => lines.filter(line => line.event === 'music.orphan_stream_failed').length,
    summary: () => lines.find(line => line.event === 'music.audio_health')?.fields,
    queue,
  }
}

// The error the stream raises when ffmpeg gives up on its own input.
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
  const harness = wiring(queue, player)

  // The engine's own listener is attached while the song starts, ours alongside.
  let engineSaw = 0
  const engineHandler = (): void => {
    engineSaw += 1
  }

  stream.on('error', engineHandler)
  play(queue, player)

  // Then the next song takes the engine's single listener away, and this ffmpeg
  // is left running with no one to hear its exit.
  queue.voice.stream = new FakeStream()
  stream.off('error', engineHandler)

  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(engineSaw).toBe(0)

  // The orphan belongs to a song the engine already reported: naming it is all
  // that is left to do. A playbackError here would tell the channel about a
  // failure it has already been told about, and ending the session would cut
  // the summary of the song now playing.
  expect(harness.lines.find(line => line.event === 'music.orphan_stream_failed')?.fields.level).toBe('warn')
  expect(harness.failures).toEqual([])
  expect(harness.has('music.playback_error')).toBe(false)
  expect(harness.ended).toEqual([])
  expect(stream.killed).toBe(1)
})

test('an orphan error leaves the song now playing with its session running', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

  play(queue, player)
  queue.voice.stream = new FakeStream()

  stream.emit('error', ffmpegExited())
  player.emit(Events.FINISH_SONG, queue, queue.songs[0])

  expect(harness.started.map(session => session.guildId)).toEqual(['g1'])
  expect(harness.ended).toEqual([{ guildId: 'g1', reason: 'finished' }])
})

test('an error on the stream the engine still listens to is not reported twice', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

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
  const summaries: Array<Record<string, unknown>> = []
  const scheduled: Array<{ run: () => void, afterMs: number, cancelled: boolean }> = []
  const now = 0
  const health = audioHealth({
    clock: { now: () => now },
    logger: logger({
      level: 'debug',
      now: () => now,
      sink(line) {
        const parsed = JSON.parse(line) as Record<string, unknown>

        if (parsed.event === 'music.audio_health')
          summaries.push(parsed)
      },
    }),
    timer(run, afterMs) {
      const entry = { run, afterMs, cancelled: false }

      scheduled.push(entry)

      return () => {
        entry.cancelled = true
      }
    },
  })
  const harness = wiring(queue, player, health)
  const live = (): number => scheduled.filter(entry => !entry.cancelled).length

  play(queue, player)
  expect(live()).toBe(1)

  // /stop: queue.stop() deletes the queue and detaches the engine's listeners,
  // so neither FINISH_SONG nor DISCONNECT ever arrives. The emitter's clear is
  // all that is left to end the session before a sample pings a dead connection,
  // and no skip happened, so the summary cannot claim one.
  harness.emitter.queueCleared({ guildId: 'g1', resetStation: true })

  expect(live()).toBe(0)
  expect(summaries.map(fields => fields.reason)).toEqual(['stopped'])
})

test('a finished, cleared or disconnected queue prunes its streams but keeps listening', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

  play(queue, player)
  expect(stream.listenerCount('error')).toBe(1)

  // The entry is gone, so the stream the queue still shows is no longer watched:
  // its exit is an orphan now, heard and named instead of thrown.
  player.emit(Events.FINISH, queue)
  expect(() => stream.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.orphans()).toBe(1)
  expect(harness.failures).toEqual([])

  // The listener outlives the map: it holds nothing the map could grow with.
  expect(stream.listenerCount('error')).toBe(1)

  play(queue, player)
  harness.emitter.queueCleared({ guildId: 'g1', resetStation: false })
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
  const harness = wiring(queue, player)

  play(queue, player)
  player.emit(Events.ERROR, new Error('boom'), queue, { id: 'song-2' })
  // without a song from the engine, the one that was playing failed
  player.emit(Events.ERROR, new Error('boom'), queue, undefined)

  expect(harness.failedSongs).toEqual(['song-2', 'song-1'])
})

test('a playback error before any song started names none', () => {
  const queue = fakeQueue(new FakeStream())
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

  player.emit(Events.ERROR, new Error('boom'), queue, undefined)

  expect(harness.failedSongs).toEqual([null])
})

test('a voice error after the engine dropped its listeners is logged, never thrown', () => {
  const queue = fakeQueue(new FakeStream())
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

  play(queue, player)
  play(queue, player)
  // queue.remove() detaches the engine's voice listeners; ours stays, once
  expect(queue.voice.listenerCount('error')).toBe(1)

  expect(() => queue.voice.emit('error', ffmpegExited())).not.toThrow()
  expect(harness.lines.find(line => line.event === 'music.voice_error')?.fields.level).toBe('warn')
  expect(harness.failures).toEqual([])
})

test('a finished song logs its audio summary, with the ping the connection reports', () => {
  const stream = new FakeStream()
  const queue = fakeQueue(stream)
  const player = fakePlayer(queue)
  const harness = wiring(queue, player)

  play(queue, player)
  expect(harness.started).toHaveLength(1)
  expect(harness.started[0]?.guildId).toBe('g1')
  expect(harness.started[0]?.title).toBe('Song 1')
  expect(harness.started[0]?.ping()).toEqual({ ws: 44, udp: 58 })

  player.emit(Events.FINISH_SONG, queue, queue.songs[0])

  expect(harness.ended).toEqual([{ guildId: 'g1', reason: 'finished' }])
})
