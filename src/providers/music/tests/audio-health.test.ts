import type { Logger } from '../../../core/logger.ts'
import type { PingSample } from '../audio-health.ts'
import { expect, test } from 'bun:test'
import { logger } from '../../../core/logger.ts'
import { audioHealth } from '../audio-health.ts'

interface Line {
  readonly event: string
  readonly fields: Record<string, unknown>
}

const noPing = (): PingSample => ({ ws: undefined, udp: undefined })

function harness() {
  const lines: Line[] = []
  const pending: Array<{ run: () => void, afterMs: number, spent: boolean }> = []
  let now = 1_000_000
  let cancelled = 0

  const log: Logger = logger({
    level: 'debug',
    now: () => now,
    sink(line) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      lines.push({ event: String(parsed.event), fields: parsed })
    },
  })

  const health = audioHealth({
    clock: { now: () => now },
    logger: log,
    timer(run, afterMs) {
      const entry = { run, afterMs, spent: false }

      pending.push(entry)

      return () => {
        entry.spent = true
        cancelled += 1
      }
    },
  })

  function live(): Array<{ run: () => void, afterMs: number, spent: boolean }> {
    return pending.filter(entry => !entry.spent)
  }

  function tick(lateMs: number): void {
    const next = live().shift()

    if (next === undefined)
      throw new Error('No sample was scheduled.')

    next.spent = true
    expect(next.afterMs).toBe(40)
    now += next.afterMs + lateMs
    next.run()
  }

  function only(event: string): Line {
    const found = lines.filter(line => line.event === event)
    expect(found).toHaveLength(1)

    return found[0] as Line
  }

  function count(event: string): number {
    return lines.filter(line => line.event === event).length
  }

  return {
    health,
    tick,
    only,
    count,
    pending: () => live().length,
    cancelled: () => cancelled,
  }
}

test('a song summary carries the worst lag and the pings it saw', () => {
  const h = harness()
  let ping = { ws: 40, udp: 60 }

  h.health.start({ guildId: 'g1', title: 'Song', ping: () => ping })
  h.tick(0)
  ping = { ws: 120, udp: 210 }
  h.tick(55)
  h.health.end('g1', 'finished')

  const summary = h.only('music.audio_health')

  expect(summary.fields.guildId).toBe('g1')
  expect(summary.fields.title).toBe('Song')
  expect(summary.fields.loopLagMaxMs).toBe(55)
  expect(summary.fields.loopStalls).toBe(1)
  expect(summary.fields.udpPingMaxMs).toBe(210)
  expect(summary.fields.wsPingMaxMs).toBe(120)
})

test('a lag under the stall threshold is measured but not counted', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'Song', ping: noPing })
  h.tick(0)
  h.tick(30)
  h.health.end('g1', 'finished')

  const summary = h.only('music.audio_health')

  expect(summary.fields.loopLagMaxMs).toBe(30)
  expect(summary.fields.loopStalls).toBe(0)
  expect(summary.fields.udpPingMaxMs).toBe(0)
  expect(summary.fields.wsPingMaxMs).toBe(0)
})

test('a long stall logs once, and again only after ten seconds', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'Song', ping: noPing })
  h.tick(150)
  expect(h.only('music.loop_stall').fields.lagMs).toBe(150)
  h.tick(400)
  expect(h.count('music.loop_stall')).toBe(1)
  h.tick(10_000)
  expect(h.count('music.loop_stall')).toBe(2)
})

test('the timer runs while a song plays, and stops with the last one', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'One', ping: noPing })
  h.health.start({ guildId: 'g2', title: 'Two', ping: noPing })
  expect(h.pending()).toBe(1)

  h.tick(0)
  h.health.end('g1', 'finished')
  expect(h.pending()).toBe(1)

  h.health.end('g2', 'skipped')
  expect(h.pending()).toBe(0)
  expect(h.cancelled()).toBe(1)
})

test('a ping that throws is contained, and the song still summarizes', () => {
  const h = harness()
  const boom = (): never => {
    throw new Error('connection destroyed')
  }

  h.health.start({ guildId: 'g1', title: 'One', ping: boom })
  h.health.start({ guildId: 'g2', title: 'Two', ping: boom })

  expect(() => h.tick(0)).not.toThrow()
  expect(() => h.health.end('g1', 'finished')).not.toThrow()

  expect(h.count('music.ping_failed')).toBe(2)
  expect(h.only('music.audio_health').fields.guildId).toBe('g1')
  expect(h.only('music.audio_health').fields.reason).toBe('finished')

  h.health.dispose()
})

test('dispose clears the timer and any pending summary', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'Song', ping: noPing })
  h.health.dispose()
  h.health.end('g1', 'error')

  expect(h.pending()).toBe(0)
  expect(h.cancelled()).toBe(1)
  expect(h.count('music.audio_health')).toBe(0)
})
