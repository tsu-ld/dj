import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import { errorMessage } from '../../core/errors.ts'

// A voice connection under 100 ms of event-loop lag starves the audio encoder,
// and a stalled read from the stream host starves it the same way: a listener
// hears the song speed up and slow down. These thresholds separate a normal
// sample, a stall, and a stall worth its own line in the log.
const SAMPLE_MS = 40
const STALL_MS = 40
const STALL_LOG_MS = 100
const STALL_LOG_COOLDOWN_MS = 10_000

export interface PingSample {
  readonly ws: number | undefined
  readonly udp: number | undefined
}

export interface AudioHealthSession {
  readonly guildId: string
  readonly title: string
  readonly ping: () => PingSample | null
}

export type AudioEndReason = 'finished' | 'skipped' | 'stopped' | 'error'

type Timer = (run: () => void, afterMs: number) => () => void

const systemTimer: Timer = (run, afterMs) => {
  const handle = setTimeout(run, afterMs)

  handle.unref()

  return () => clearTimeout(handle)
}

export interface AudioHealth {
  start: (session: AudioHealthSession) => void
  end: (guildId: string, reason: AudioEndReason) => void
  dispose: () => void
}

interface Counters {
  lagMax: number
  stalls: number
  udpMax: number
  wsMax: number
}

interface Entry {
  readonly session: AudioHealthSession
  readonly counters: Counters
  pingFailed: boolean
}

function freshest(current: number, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0)
    return current

  return Math.max(current, Math.round(value))
}

// One loop serves every guild: the lag is the process's, so a timer per guild
// would only measure the same thing twice. It runs only while a song plays.
export function audioHealth(deps: { clock: Clock, logger: Logger, timer?: Timer }): AudioHealth {
  const { clock, logger } = deps
  const timer = deps.timer ?? systemTimer
  const entries = new Map<string, Entry>()
  let cancel: (() => void) | null = null
  let dueAt = 0
  let lastStallLogAt = Number.NEGATIVE_INFINITY

  // The ping reaches into a connection the engine may already have destroyed, so
  // the call can throw. This runs inside a timer: an escaping throw is an
  // uncaught exception, so the sample is dropped, named once per song.
  function samplePings(): void {
    for (const entry of entries.values()) {
      try {
        const ping = entry.session.ping()

        if (ping === null)
          continue

        entry.counters.udpMax = freshest(entry.counters.udpMax, ping.udp)
        entry.counters.wsMax = freshest(entry.counters.wsMax, ping.ws)
      }
      catch (error) {
        if (entry.pingFailed)
          continue

        entry.pingFailed = true
        logger.warn('music.ping_failed', { guildId: entry.session.guildId, error: errorMessage(error) })
      }
    }
  }

  function schedule(): void {
    dueAt = clock.now() + SAMPLE_MS
    cancel = timer(tick, SAMPLE_MS)
  }

  function tick(): void {
    cancel = null

    const now = clock.now()
    const lagMs = Math.max(0, Math.round(now - dueAt))

    for (const { counters } of entries.values()) {
      counters.lagMax = Math.max(counters.lagMax, lagMs)

      if (lagMs > STALL_MS)
        counters.stalls += 1
    }

    if (lagMs > STALL_LOG_MS && now - lastStallLogAt >= STALL_LOG_COOLDOWN_MS) {
      lastStallLogAt = now
      logger.warn('music.loop_stall', { lagMs })
    }

    samplePings()

    if (entries.size > 0)
      schedule()
  }

  function stop(): void {
    cancel?.()
    cancel = null
  }

  return {
    start(session) {
      entries.set(session.guildId, {
        session,
        counters: { lagMax: 0, stalls: 0, udpMax: 0, wsMax: 0 },
        pingFailed: false,
      })

      samplePings()

      if (cancel === null)
        schedule()
    },
    end(guildId, reason) {
      const entry = entries.get(guildId)

      if (entry === undefined)
        return

      entries.delete(guildId)
      samplePings()

      logger.info('music.audio_health', {
        guildId,
        title: entry.session.title,
        reason,
        loopLagMaxMs: entry.counters.lagMax,
        loopStalls: entry.counters.stalls,
        udpPingMaxMs: entry.counters.udpMax,
        wsPingMaxMs: entry.counters.wsMax,
      })

      if (entries.size === 0)
        stop()
    },
    dispose() {
      entries.clear()
      stop()
    },
  }
}
