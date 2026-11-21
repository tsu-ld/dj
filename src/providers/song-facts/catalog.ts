import { isRecord } from '../../core/json.ts'
import { eitherContains } from './title.ts'

const SEARCH_URL = 'https://api.deezer.com/search'
const ALBUM_URL = 'https://api.deezer.com/album'
const SEARCH_LIMIT = 5
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_YEAR = 1900
const MAX_YEAR = 2100

export interface SearchHit {
  readonly album: string | null
  readonly albumId: number | null
  readonly artist: string
  readonly title: string
}

export interface AlbumFacts {
  readonly album: string | null
  readonly genre: string | null
  readonly releaseDate: string | null
  readonly year: number | null
}

export const EMPTY_ALBUM: AlbumFacts = { album: null, genre: null, releaseDate: null, year: null }

function isFailedAnswer(payload: unknown): boolean {
  return !isRecord(payload) || 'error' in payload
}

// WORKAROUND(https://api.deezer.com/search?q=artist:%22Queen%22%20track:%22Bohemian%20Rhapsody%22): Deezer's advanced syntax answers an empty page; a plain query finds the track and is what the search sends. Goes when that URL returns the track.
export function searchUrl(title: string, artist: string): string {
  return `${SEARCH_URL}?q=${encodeURIComponent(`${artist} ${title}`)}&limit=${SEARCH_LIMIT}`
}

export function albumUrl(id: number): string {
  return `${ALBUM_URL}/${id}`
}

export function searchHit(payload: unknown, artist: string, track: string): SearchHit | null {
  if (isFailedAnswer(payload)) {
    return null
  }

  const results = isRecord(payload) ? payload.data : null

  if (!Array.isArray(results)) {
    return null
  }

  for (const entry of results.slice(0, SEARCH_LIMIT)) {
    if (!isRecord(entry)) {
      continue
    }

    const fullTitle = entry.title
    const shortTitle = entry.title_short
    const name = isRecord(entry.artist) ? entry.artist.name : null
    const album = isRecord(entry.album) ? entry.album.title : null
    const albumId =
      isRecord(entry.album) && typeof entry.album.id === 'number' ? entry.album.id : null

    if (typeof fullTitle !== 'string' || typeof name !== 'string') {
      continue
    }

    const label = typeof shortTitle === 'string' && shortTitle !== '' ? shortTitle : fullTitle

    if (!eitherContains(name, artist)) {
      continue
    }

    if (!eitherContains(label, track) && !eitherContains(fullTitle, track)) {
      continue
    }

    return { artist: name, title: label, album: typeof album === 'string' ? album : null, albumId }
  }

  return null
}

interface ReleaseFacts {
  readonly releaseDate: string | null
  readonly year: number | null
}

const UNKNOWN_RELEASE: ReleaseFacts = { releaseDate: null, year: null }

function isKnownCalendarDate(year: number, month: number, day: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

function releaseFacts(raw: unknown): ReleaseFacts {
  if (typeof raw !== 'string' || !RELEASE_DATE.test(raw)) {
    return UNKNOWN_RELEASE
  }

  const [year = 0, month = 0, day = 0] = raw.split('-').map(Number)

  if (!isKnownCalendarDate(year, month, day)) {
    return UNKNOWN_RELEASE
  }

  return { releaseDate: raw, year }
}

export function albumFacts(payload: unknown, fallbackTitle: string | null): AlbumFacts {
  if (!isRecord(payload) || 'error' in payload) {
    return { ...EMPTY_ALBUM, album: fallbackTitle }
  }

  const title = typeof payload.title === 'string' ? payload.title : fallbackTitle
  const genres =
    isRecord(payload.genres) && Array.isArray(payload.genres.data) ? payload.genres.data : []
  const first: unknown = genres[0]
  const genre = isRecord(first) && typeof first.name === 'string' ? first.name : null

  return { album: title, genre, ...releaseFacts(payload.release_date) }
}
