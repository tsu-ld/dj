import type { ListenerProfile } from '../../ports/listeners.ts'
import type { SongFacts } from '../../ports/song-facts.ts'
import { describe, expect, test } from 'bun:test'
import { testTrack as track } from '../../tests/fixtures.ts'
import { anniversaryOf, pickAngle } from '../angle.ts'

const NOW = Date.UTC(2026, 10, 18, 12)
const DAY = 86_400_000

function facts(extra: Partial<SongFacts> = {}): SongFacts {
  return {
    artist: 'Soda Stereo',
    title: 'Tema',
    album: null,
    year: null,
    releaseDate: null,
    genre: null,
    artistSummary: null,
    songSummary: null,
    news: [],
    ...extra,
  }
}

const REGULAR: ListenerProfile = {
  name: 'tsu',
  requests: 7,
  topSong: { title: 'Matador', count: 3 },
  topArtists: ['Los Fabulosos Cadillacs'],
}

const ALL_FACTS = facts({
  album: 'Canción animal',
  year: 1996,
  releaseDate: '1996-11-19',
  genre: 'Rock',
  songSummary: 'A story.',
  news: [{ title: 'News', source: 'Paper', publishedAt: NOW - DAY }],
})

function pick(extra: Partial<Parameters<typeof pickAngle>[0]> = {}) {
  return pickAngle({
    long: true,
    first: false,
    track: track('Tema'),
    facts: null,
    listener: null,
    lastAngle: null,
    now: NOW,
    ...extra,
  })
}

describe('pickAngle priority', () => {
  test('the first line is a welcome, whatever else is known', () => {
    expect(pick({ first: true, facts: ALL_FACTS, listener: { ...REGULAR, requests: 0 } })).toBe(
      'welcome',
    )
  })

  test('each angle wins when everything above it is missing', () => {
    const milestone = { ...REGULAR, requests: 0 }

    expect(pick({ listener: milestone, facts: ALL_FACTS })).toBe('listener')
    expect(pick({ listener: REGULAR, facts: ALL_FACTS })).toBe('anniversary')
    expect(pick({ facts: { ...ALL_FACTS, releaseDate: null, year: 1999 } })).toBe('story')
    expect(
      pick({ facts: { ...ALL_FACTS, releaseDate: null, year: 1999, songSummary: null } }),
    ).toBe('news')
    expect(pick({ facts: facts({ genre: 'Rock' }) })).toBe('fact')
    expect(pick({ facts: null })).toBe('run')
  })

  test('a short line never tells a story', () => {
    expect(pick({ long: false, facts: facts({ songSummary: 'A story.' }) })).toBe('run')
    expect(pick({ long: false, facts: facts({ songSummary: 'A story.', genre: 'Rock' }) })).toBe(
      'fact',
    )
  })
})

describe('pickAngle data', () => {
  test('missing data never picks its angle', () => {
    expect(pick({ listener: null })).toBe('run')
    expect(pick({ listener: REGULAR })).toBe('run')
    expect(pick({ facts: facts() })).toBe('run')
    expect(
      pick({
        facts: facts({ news: [{ title: 'Old', source: null, publishedAt: NOW - 15 * DAY }] }),
      }),
    ).toBe('run')
    expect(pick({ facts: facts({ releaseDate: '2002-06-01', year: 2002 }) })).toBe('fact')
  })

  test('a listener milestone: first request, round count, top song or top artist', () => {
    expect(pick({ listener: { ...REGULAR, requests: 0 } })).toBe('listener')

    for (const number of [5, 10, 25, 50, 100]) {
      expect(pick({ listener: { ...REGULAR, requests: number - 1 } })).toBe('listener')
    }

    for (const requests of [1, 5, 6, 10, 25]) {
      expect(pick({ listener: { ...REGULAR, requests } })).toBe('run')
    }

    expect(pick({ listener: REGULAR, track: track('MATADOR (Official Video) [HD]') })).toBe(
      'listener',
    )
    expect(
      pick({
        listener: { ...REGULAR, topArtists: ['soda stereo'] },
        track: track('Tema', { artist: 'Soda Stereo' }),
      }),
    ).toBe('listener')
  })

  test("a radio pick is nobody's milestone", () => {
    expect(
      pick({ listener: { ...REGULAR, requests: 0 }, track: track('Tema', { fromRadio: true }) }),
    ).toBe('run')
  })
})

describe('pickAngle rotation', () => {
  test('the last angle is not repeated: the next available one is taken', () => {
    const milestone = { ...REGULAR, requests: 0 }

    expect(pick({ listener: milestone, facts: ALL_FACTS, lastAngle: 'listener' })).toBe(
      'anniversary',
    )
    expect(pick({ facts: facts({ genre: 'Rock' }), lastAngle: 'fact' })).toBe('run')
  })

  test('run repeats when nothing else is left', () => {
    expect(pick({ lastAngle: 'run' })).toBe('run')
  })
})

describe('anniversaryOf', () => {
  test('a release day within three days either side', () => {
    expect(anniversaryOf(facts({ releaseDate: '1986-11-21' }), NOW)).toEqual({ years: 40, days: 3 })
    expect(anniversaryOf(facts({ releaseDate: '1993-11-15' }), NOW)).toEqual({
      years: 33,
      days: -3,
    })
    expect(anniversaryOf(facts({ releaseDate: '2003-11-18' }), NOW)).toEqual({ years: 23, days: 0 })
    expect(anniversaryOf(facts({ releaseDate: '1993-11-22' }), NOW)).toBeNull()
    expect(anniversaryOf(facts({ releaseDate: '1993-11-14' }), NOW)).toBeNull()
  })

  test('the window crosses New Year', () => {
    const newYear = Date.UTC(2027, 0, 1, 10)

    expect(anniversaryOf(facts({ releaseDate: '1999-12-30' }), newYear)).toEqual({
      years: 27,
      days: -2,
    })
    expect(anniversaryOf(facts({ releaseDate: '2000-01-03' }), Date.UTC(2026, 11, 31))).toEqual({
      years: 27,
      days: 3,
    })
  })

  test('a round age counts only near the release day, at the exact age', () => {
    expect(anniversaryOf(facts({ releaseDate: '2006-12-25', year: 2006 }), NOW)).toBeNull()
    expect(anniversaryOf(facts({ releaseDate: '2006-11-20', year: 2006 }), NOW)).toEqual({
      years: 20,
      days: 2,
    })
    expect(anniversaryOf(facts({ releaseDate: '1976-03-01', year: 1976 }), NOW)).toBeNull()

    for (const years of [10, 20, 25, 30, 40, 50]) {
      expect(anniversaryOf(facts({ year: 2026 - years }), NOW)).toBeNull()
    }
  })

  test('a song released this week is not an anniversary', () => {
    expect(anniversaryOf(facts({ releaseDate: '2026-11-16' }), NOW)).toBeNull()
  })
})
