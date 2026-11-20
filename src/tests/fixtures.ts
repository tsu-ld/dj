import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { QueueView, Track } from '../ports/music.ts'
import { logger } from '../core/logger.ts'

export interface TestClock extends Clock {
  advance: (milliseconds: number) => void
}

export function testClock(start = 1_000_000): TestClock {
  let now = start

  return {
    now: () => now,
    advance(milliseconds) {
      now += milliseconds
    },
  }
}

// One shared instance: a silent logger has no state worth isolating per suite.
export const silentLog: Logger = logger({ level: 'error', sink: () => {} })

// Accepts a title or an overrides object so a suite can build either a named
// song or a full fake without repeating every field.
export function testTrack(first: string | Partial<Track> = {}, overrides: Partial<Track> = {}): Track {
  const input = typeof first === 'string' ? { title: first, ...overrides } : { ...first, ...overrides }
  const title = input.title ?? 'Song 1'

  return {
    id: input.id ?? title,
    title,
    url: 'https://youtu.be/1',
    durationSeconds: 180,
    isLive: false,
    thumbnail: null,
    requestedBy: null,
    requesterId: null,
    artist: null,
    fromRadio: false,
    ...input,
  }
}

export function testView(overrides: Partial<QueueView> = {}): QueueView {
  const current = overrides.current === undefined ? testTrack() : overrides.current
  const upcoming = overrides.upcoming ?? []

  return {
    current,
    upcoming,
    paused: false,
    radio: false,
    size: (current === null ? 0 : 1) + upcoming.length,
    ...overrides,
  }
}
