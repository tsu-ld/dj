import type { Clock } from '../../core/clock.ts'
import { describe, expect, test } from 'bun:test'
import { PREPARED_CLIP_TTL_MS } from '../../limits.ts'
import { onAirStation, shouldSpeak } from '../station.ts'

interface TestClock extends Clock {
  advance: (milliseconds: number) => void
}

function fakeClock(start = 1_000_000): TestClock {
  let now = start

  return {
    now: () => now,
    sleep: async () => {},
    advance: (milliseconds) => {
      now += milliseconds
    },
  }
}

describe('cadence', () => {
  test('the first line and every fifth after it are long', () => {
    const station = onAirStation({ clock: fakeClock() })
    const long: boolean[] = []

    for (let line = 0; line < 6; line++) {
      long.push(station.shouldUseLongLine('g1'))
      station.recordLine('g1')
    }

    expect(long).toEqual([true, false, false, false, false, true])
  })

  test('a line that never aired does not use up the long slot', () => {
    const station = onAirStation({ clock: fakeClock() })

    expect(station.shouldUseLongLine('g1')).toBe(true)
    expect(station.shouldUseLongLine('g1')).toBe(true)

    station.recordLine('g1')

    expect(station.shouldUseLongLine('g1')).toBe(false)
  })

  test('each guild keeps its own cadence', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.recordLine('g1')

    expect(station.shouldUseLongLine('g2')).toBe(true)
    expect(station.shouldUseLongLine('g1')).toBe(false)
  })

  test('one requested song in three runs without a line', () => {
    expect([1, 2, 3, 4, 5, 6].map(index => shouldSpeak(index)))
      .toEqual([true, true, false, true, true, false])
  })

  test('autoplay songs talk even less', () => {
    expect([1, 2, 3, 4, 5, 6].map(index => shouldSpeak(index, true)))
      .toEqual([false, false, true, false, false, true])
  })

  test('ending a session keeps the cadence', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.recordSong('g-end', 'a')
    station.endSession('g-end')

    expect(station.nextSongIndex('g-end')).toBe(2)
    expect(station.songOnAir('g-end')).toBeNull()
  })

  test('a manual reset starts the cadence over', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.recordSong('g-reset', 'a')
    station.reset('g-reset')

    expect(station.recordSong('g-reset', 'b')).toBe(1)
  })

  test('the next song takes the slot right after the one on air', () => {
    const station = onAirStation({ clock: fakeClock() })

    expect(station.nextSongIndex('g-next')).toBe(1)

    station.recordSong('g-next', 'a')

    expect(station.nextSongIndex('g-next')).toBe(2)
  })
})

describe('prepared clips', () => {
  test('a fresh clip belongs to exactly one song', () => {
    const station = onAirStation({ clock: fakeClock() })

    expect(station.setPrepared('g1', { songId: 'a', file: '/tmp/a.mp3' })).toBeNull()
    expect(station.preparedFor('g1', 'a')).toBe(true)
    expect(station.preparedFor('g1', 'b')).toBe(false)

    const taken = station.takePrepared('g1', 'a')

    expect(taken.clip?.file).toBe('/tmp/a.mp3')
    expect(taken.discarded).toBeNull()
    expect(station.preparedFor('g1', 'a')).toBe(false)
  })

  test('a clip for another song is discarded, file and all', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.setPrepared('g1', { songId: 'b', file: '/tmp/b.mp3' })

    const taken = station.takePrepared('g1', 'c')

    expect(taken.clip).toBeNull()
    expect(taken.discarded?.file).toBe('/tmp/b.mp3')
  })

  test('a clip expires after twenty minutes', () => {
    const clock = fakeClock()
    const station = onAirStation({ clock })

    station.setPrepared('g1', { songId: 'a', file: '/tmp/a.mp3' })
    clock.advance(PREPARED_CLIP_TTL_MS)

    expect(station.takePrepared('g1', 'a').clip?.file).toBe('/tmp/a.mp3')

    station.setPrepared('g1', { songId: 'a', file: '/tmp/a.mp3' })
    clock.advance(PREPARED_CLIP_TTL_MS + 1)

    const expired = station.takePrepared('g1', 'a')

    expect(expired.clip).toBeNull()
    expect(expired.discarded?.file).toBe('/tmp/a.mp3')
  })

  test('replacing a clip hands back the old one for deletion', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.setPrepared('g1', { songId: 'a', file: '/tmp/a.mp3' })

    const previous = station.setPrepared('g1', { songId: 'b', file: '/tmp/b.mp3' })

    expect(previous?.file).toBe('/tmp/a.mp3')
    expect(station.preparedFor('g1', 'b')).toBe(true)
  })

  test('ending a session drops the clip without touching the cadence', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.recordSong('g1', 'a')
    station.setPrepared('g1', { songId: 'b', file: '/tmp/b.mp3' })

    const clip = station.endSession('g1')

    expect(clip?.file).toBe('/tmp/b.mp3')
    expect(station.preparedFor('g1', 'b')).toBe(false)
    expect(station.nextSongIndex('g1')).toBe(2)
  })

  test('a reset drops the clip and the cadence', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.recordSong('g1', 'a')
    station.recordLine('g1')
    station.setPrepared('g1', { songId: 'b', file: '/tmp/b.mp3' })

    const clip = station.reset('g1')

    expect(clip?.file).toBe('/tmp/b.mp3')
    expect(station.nextSongIndex('g1')).toBe(1)
    expect(station.shouldUseLongLine('g1')).toBe(true)
  })

  test('clearing hands every clip back for deletion', () => {
    const station = onAirStation({ clock: fakeClock() })

    station.setPrepared('g1', { songId: 'a', file: '/tmp/a.mp3' })
    station.setPrepared('g2', { songId: 'b', file: '/tmp/b.mp3' })

    const clips = station.clear().map(clip => clip.file)

    expect(clips.toSorted()).toEqual(['/tmp/a.mp3', '/tmp/b.mp3'])
    expect(station.preparedFor('g1', 'a')).toBe(false)
  })
})
