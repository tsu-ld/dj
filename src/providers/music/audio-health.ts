import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'

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
  readonly ping: () => PingSample
}

export type AudioEndReason = 'finished' | 'skipped' | 'stopped' | 'error'

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
}

function freshest(current: number, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return current
  }

  return Math.max(current, Math.round(value))
}

export function audioHealth(deps: { clock: Clock; logger: Logger }): AudioHealth {
  const { clock, logger } = deps
  const entries = new Map<string, Entry>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let dueAt = 0
  let lastStallLogAt = Number.NEGATIVE_INFINITY

  function samplePings(): void {
    for (const entry of entries.values()) {
      const ping = entry.session.ping()

      entry.counters.udpMax = freshest(entry.counters.udpMax, ping.udp)
      entry.counters.wsMax = freshest(entry.counters.wsMax, ping.ws)
    }
  }

  function schedule(): void {
    dueAt = clock.now() + SAMPLE_MS
    timer = setTimeout(tick, SAMPLE_MS)
    timer.unref()
  }

  function tick(): void {
    timer = null

    const now = clock.now()
    const lagMs = Math.max(0, Math.round(now - dueAt))

    for (const { counters } of entries.values()) {
      counters.lagMax = Math.max(counters.lagMax, lagMs)

      if (lagMs > STALL_MS) {
        counters.stalls += 1
      }
    }

    if (lagMs > STALL_LOG_MS && now - lastStallLogAt >= STALL_LOG_COOLDOWN_MS) {
      lastStallLogAt = now
      logger.warn('music.loop_stall', { lagMs })
    }

    samplePings()

    if (entries.size > 0) {
      schedule()
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearTimeout(timer)
    }

    timer = null
  }

  return {
    start(session) {
      entries.set(session.guildId, {
        session,
        counters: { lagMax: 0, stalls: 0, udpMax: 0, wsMax: 0 },
      })

      samplePings()

      if (timer === null) {
        schedule()
      }
    },
    end(guildId, reason) {
      const entry = entries.get(guildId)

      if (entry === undefined) {
        return
      }

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

      if (entries.size === 0) {
        stop()
      }
    },
    dispose() {
      entries.clear()
      stop()
    },
  }
}
