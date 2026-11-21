import type { PingSample } from '../audio-health.ts'
import { afterEach, expect, jest, spyOn, test } from 'bun:test'
import { isRecord } from '../../../core/json.ts'
import { captureLog } from '../../../tests/fixtures.ts'
import { audioHealth } from '../audio-health.ts'

const noPing = (): PingSample => ({ ws: undefined, udp: undefined })

function harness() {
  let now = 1_000_000
  let clockReads = 0

  jest.useFakeTimers()

  const clearTimer = spyOn(globalThis, 'clearTimeout')
  const log = captureLog()

  const health = audioHealth({
    clock: {
      now: () => {
        clockReads += 1

        return now
      },
    },
    logger: log.logger,
  })

  function tick(lateMs: number): void {
    const readsBefore = clockReads

    jest.advanceTimersByTime(39)
    expect(clockReads).toBe(readsBefore)

    now += 40 + lateMs
    jest.advanceTimersByTime(1)

    if (clockReads === readsBefore)
      throw new Error('No sample was scheduled.')
  }

  function only(event: string): Record<string, unknown> {
    const found = log.entries(event)
    expect(found).toHaveLength(1)

    const [entry] = found

    if (!isRecord(entry))
      throw new Error(`No ${event} line was logged.`)

    return entry
  }

  function count(event: string): number {
    return log.entries(event).length
  }

  return {
    health,
    tick,
    only,
    count,
    pending: () => jest.getTimerCount(),
    cancelled: () => clearTimer.mock.calls.length,
  }
}

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

test('a song summary carries the worst lag and the pings it saw', () => {
  const h = harness()
  let ping = { ws: 40, udp: 60 }

  h.health.start({ guildId: 'g1', title: 'Song', ping: () => ping })
  h.tick(0)
  ping = { ws: 120, udp: 210 }
  h.tick(55)
  h.health.end('g1', 'finished')

  const summary = h.only('music.audio_health')

  expect(summary.guildId).toBe('g1')
  expect(summary.title).toBe('Song')
  expect(summary.loopLagMaxMs).toBe(55)
  expect(summary.loopStalls).toBe(1)
  expect(summary.udpPingMaxMs).toBe(210)
  expect(summary.wsPingMaxMs).toBe(120)
})

test('a lag under the stall threshold is measured but not counted', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'Song', ping: noPing })
  h.tick(0)
  h.tick(30)
  h.health.end('g1', 'finished')

  const summary = h.only('music.audio_health')

  expect(summary.loopLagMaxMs).toBe(30)
  expect(summary.loopStalls).toBe(0)
  expect(summary.udpPingMaxMs).toBe(0)
  expect(summary.wsPingMaxMs).toBe(0)
})

test('a long stall logs once, and again only after ten seconds', () => {
  const h = harness()

  h.health.start({ guildId: 'g1', title: 'Song', ping: noPing })
  h.tick(150)
  expect(h.only('music.loop_stall').lagMs).toBe(150)
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
  expect(h.only('music.audio_health').guildId).toBe('g1')
  expect(h.only('music.audio_health').reason).toBe('finished')

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
