import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { QueueView, Track } from '../ports/music.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecord, parseJson } from '../core/json.ts'
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

export const silentLog: Logger = logger({ level: 'error', sink: () => {} })

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

const tempDirs: string[] = []

export async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dj-test-'))

  tempDirs.push(directory)

  return directory
}

export async function removeTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map(async directory => rm(directory, { recursive: true, force: true })))
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn++)
    await Promise.resolve()
}

export interface CapturedLog {
  logger: Logger
  events: string[]
  entries: (event: string) => unknown[]
}

export function captureLog(): CapturedLog {
  const records: Record<string, unknown>[] = []
  const events: string[] = []

  return {
    logger: logger({
      level: 'debug',
      sink(line) {
        const parsed = parseJson(line)

        if (isRecord(parsed) && typeof parsed.event === 'string') {
          records.push(parsed)
          events.push(parsed.event)
        }
      },
    }),
    events,
    entries: event => records.filter(record => record.event === event),
  }
}
