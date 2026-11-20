import type { PlayedEntry, Station, StationSong } from '../station.ts'
import { describe, expect, test } from 'bun:test'
import { PREPARED_CLIP_TTL_MS, RADIO_MEMORY_MS, RADIO_MEMORY_SIZE } from '../../limits.ts'
import { testClock } from '../../tests/fixtures.ts'
import { onAirStation, shouldSpeak } from '../station.ts'

function song(id: string, extra: Partial<StationSong> = {}): StationSong {
  return { id, title: id.toUpperCase(), artist: null, requestedBy: null, fromRadio: false, ...extra }
}

function clip(songId: string, key = 'k'): { songId: string, key: string, file: string, angle: 'run', line: string } {
  return { songId, key, file: `/tmp/${songId}.mp3`, angle: 'run', line: `line ${songId}` }
}

// The run as the station keeps it, oldest first.
function runOf(station: Station): PlayedEntry[] {
  const { last, earlier } = station.run('g1')

  return last === null ? [] : [...earlier.toReversed(), last]
}

describe('cadence', () => {
  test('the first line and every second after it are long', () => {
    const station = onAirStation({ clock: testClock() })
    const long: boolean[] = []

    for (let line = 0; line < 6; line++) {
      long.push(station.shouldUseLongLine('g1'))
      station.recordLine('g1')
    }

    expect(long).toEqual([true, false, true, false, true, false])
  })

  test('a line that never aired does not use up the long slot', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.shouldUseLongLine('g1')).toBe(true)
    expect(station.shouldUseLongLine('g1')).toBe(true)

    station.recordLine('g1')

    expect(station.shouldUseLongLine('g1')).toBe(false)
  })

  test('each guild keeps its own cadence', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordLine('g1')

    expect(station.shouldUseLongLine('g2')).toBe(true)
    expect(station.shouldUseLongLine('g1')).toBe(false)
  })

  test('one requested song in three runs without a line', () => {
    expect([1, 2, 3, 4, 5, 6].map(index => shouldSpeak(index, false)))
      .toEqual([true, true, false, true, true, false])
  })

  test('autoplay songs talk even less', () => {
    expect([1, 2, 3, 4, 5, 6].map(index => shouldSpeak(index, true)))
      .toEqual([false, false, true, false, false, true])
  })

  test('ending a session keeps the cadence', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g-end', song('a'))
    station.endSession('g-end')

    expect(station.nextSongIndex('g-end')).toBe(2)
    expect(station.songOnAir('g-end')).toBeNull()
  })

  test('a manual reset starts the cadence over', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g-reset', song('a'))
    station.reset('g-reset')

    expect(station.recordSong('g-reset', song('b'))).toBe(1)
  })

  test('the next song takes the slot right after the one on air', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.nextSongIndex('g-next')).toBe(1)

    station.recordSong('g-next', song('a'))

    expect(station.nextSongIndex('g-next')).toBe(2)
  })
})

describe('prepared clips', () => {
  test('a fresh clip belongs to exactly one song', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.setPrepared('g1', clip('a'))).toBeNull()
    expect(station.preparedFor('g1', 'a', 'k')).toBe(true)
    expect(station.preparedFor('g1', 'b', 'k')).toBe(false)

    const taken = station.takePrepared('g1', 'a', 'k')

    expect(taken.clip?.file).toBe('/tmp/a.mp3')
    expect(taken.clip?.line).toBe('line a')
    expect(taken.discarded).toBeNull()
    expect(station.preparedFor('g1', 'a', 'k')).toBe(false)
  })

  test('a clip for another song is discarded, file and all', () => {
    const station = onAirStation({ clock: testClock() })

    station.setPrepared('g1', clip('b'))

    const taken = station.takePrepared('g1', 'c', 'k')

    expect(taken.clip).toBeNull()
    expect(taken.discarded?.file).toBe('/tmp/b.mp3')
  })

  test('a clip written from other facts is not prepared and is discarded', () => {
    const station = onAirStation({ clock: testClock() })

    station.setPrepared('g1', clip('b', 'before shuffle'))

    expect(station.preparedFor('g1', 'b', 'after shuffle')).toBe(false)

    const taken = station.takePrepared('g1', 'b', 'after shuffle')

    expect(taken.clip).toBeNull()
    expect(taken.discarded?.file).toBe('/tmp/b.mp3')
  })

  test('a clip expires after twenty minutes', () => {
    const clock = testClock()
    const station = onAirStation({ clock })

    station.setPrepared('g1', clip('a'))
    clock.advance(PREPARED_CLIP_TTL_MS)

    expect(station.takePrepared('g1', 'a', 'k').clip?.file).toBe('/tmp/a.mp3')

    station.setPrepared('g1', clip('a'))
    clock.advance(PREPARED_CLIP_TTL_MS + 1)

    const expired = station.takePrepared('g1', 'a', 'k')

    expect(expired.clip).toBeNull()
    expect(expired.discarded?.file).toBe('/tmp/a.mp3')
  })

  test('replacing a clip hands back the old one for deletion', () => {
    const station = onAirStation({ clock: testClock() })

    station.setPrepared('g1', clip('a'))

    const previous = station.setPrepared('g1', clip('b'))

    expect(previous?.file).toBe('/tmp/a.mp3')
    expect(station.preparedFor('g1', 'b', 'k')).toBe(true)
  })

  test('ending a session drops the clip without touching the cadence', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g1', song('a'))
    station.setPrepared('g1', clip('b'))

    const dropped = station.endSession('g1')

    expect(dropped?.file).toBe('/tmp/b.mp3')
    expect(station.preparedFor('g1', 'b', 'k')).toBe(false)
    expect(station.nextSongIndex('g1')).toBe(2)
  })

  test('a reset drops the clip and the cadence', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g1', song('a'))
    station.recordLine('g1')
    station.setPrepared('g1', clip('b'))

    const dropped = station.reset('g1')

    expect(dropped?.file).toBe('/tmp/b.mp3')
    expect(station.nextSongIndex('g1')).toBe(1)
    expect(station.shouldUseLongLine('g1')).toBe(true)
  })

  test('clearing hands every clip back for deletion', () => {
    const station = onAirStation({ clock: testClock() })

    station.setPrepared('g1', clip('a'))
    station.setPrepared('g2', clip('b'))

    const clips = station.clear().map(cleared => cleared.file)

    expect(clips.toSorted()).toEqual(['/tmp/a.mp3', '/tmp/b.mp3'])
    expect(station.preparedFor('g1', 'a', 'k')).toBe(false)
  })
})

describe('run and session', () => {
  test('the run is newest first, holds at most three earlier songs and carries who skipped', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.run('g1')).toEqual({ lastId: null, last: null, earlier: [] })

    for (const id of ['a', 'b', 'c', 'd'])
      station.recordSong('g1', song(id, { requestedBy: 'tsu', artist: 'Band' }))

    station.recordSong('g1', song('e', { fromRadio: true }))
    station.markSkipped('g1', 'e', 'Ana')

    const run = station.run('g1')

    expect(run.lastId).toBe('e')
    expect(run.last).toMatchObject({ title: 'E', fromRadio: true, skippedBy: 'Ana' })
    expect(run.earlier.map(entry => [entry.title, entry.artist, entry.requestedBy, entry.skippedBy])).toEqual([
      ['D', 'Band', 'tsu', null],
      ['C', 'Band', 'tsu', null],
      ['B', 'Band', 'tsu', null],
    ])
  })

  test('a skip marks only the newest play of a repeated song', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g1', song('a'))
    station.recordSong('g1', song('b'))
    station.recordSong('g1', song('a'))
    station.markSkipped('g1', 'a', 'Ana')

    expect(runOf(station).map(played => played.skippedBy)).toEqual([null, null, 'Ana'])
  })

  test('the first line of a session follows the start, a disconnect and a reset', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.firstOfSession('g1')).toBe(true)

    station.recordSong('g1', song('a'))

    expect(station.firstOfSession('g1')).toBe(false)

    station.endSession('g1')

    expect(station.firstOfSession('g1')).toBe(true)

    station.recordSong('g1', song('b'))
    station.reset('g1')

    expect(station.firstOfSession('g1')).toBe(true)
  })

  test('the last angle survives a disconnect and a reset forgets it', () => {
    const station = onAirStation({ clock: testClock() })

    expect(station.lastAngle('g1')).toBeNull()

    station.recordAngle('g1', 'news')
    station.endSession('g1')

    expect(station.lastAngle('g1')).toBe('news')
    expect(station.lastAngle('g2')).toBeNull()

    station.reset('g1')

    expect(station.lastAngle('g1')).toBeNull()
  })
})

describe('recent songs', () => {
  test('keeps the run in order, repeats included', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g1', song('a', { title: 'Matador', requestedBy: 'tsu' }))
    station.recordSong('g1', song('b', { title: 'La Luna', fromRadio: true }))
    station.recordSong('g1', song('a', { title: 'Matador', requestedBy: 'tsu' }))

    expect(runOf(station).map(played => [played.title, played.requestedBy, played.fromRadio])).toEqual([
      ['Matador', 'tsu', false],
      ['La Luna', null, true],
      ['Matador', 'tsu', false],
    ])
  })

  test('the run shows the newest songs of a long window', () => {
    const station = onAirStation({ clock: testClock() })

    for (let index = 0; index < RADIO_MEMORY_SIZE + 3; index++)
      station.recordSong('g1', song(String(index)))

    expect(runOf(station).map(played => played.title)).toEqual(
      Array.from({ length: 4 }, (_, index) => String(RADIO_MEMORY_SIZE + index - 1)),
    )
    expect(station.run('g1').lastId).toBe(String(RADIO_MEMORY_SIZE + 2))
  })

  test('forgets a song after half an hour', () => {
    const clock = testClock()
    const station = onAirStation({ clock })

    station.recordSong('g1', song('a'))
    clock.advance(RADIO_MEMORY_MS)

    expect(runOf(station)).toHaveLength(1)

    clock.advance(1)

    expect(runOf(station)).toHaveLength(0)
  })

  test('a disconnect keeps the recent songs and a reset drops them', () => {
    const station = onAirStation({ clock: testClock() })

    station.recordSong('g1', song('a'))
    station.endSession('g1')

    expect(runOf(station)).toHaveLength(1)

    station.reset('g1')

    expect(runOf(station)).toHaveLength(0)
  })
})
