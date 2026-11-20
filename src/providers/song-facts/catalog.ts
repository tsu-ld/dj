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
  // Search results are tracks: their own id is the track, not the album.
  readonly albumId: number | null
  readonly artist: string
  readonly id: number
  readonly title: string
}

export interface AlbumFacts {
  readonly album: string | null
  readonly genre: string | null
  readonly releaseDate: string | null
  readonly year: number | null
}

export const EMPTY_ALBUM: AlbumFacts = { album: null, genre: null, releaseDate: null, year: null }

// Deezer reports a failure as HTTP 200 with an `error` object.
function isErrorPayload(payload: unknown): boolean {
  return !isRecord(payload) || 'error' in payload
}

// The advanced syntax (q=artist:"A" track:"T") answers an empty page today; a
// plain query finds the same track, and the artist check below still refuses a
// cover band. title_short is what the track is called ("The Chain"), title
// carries the remaster suffix.
export function searchUrl(title: string, artist: string): string {
  return `${SEARCH_URL}?q=${encodeURIComponent(`${artist} ${title}`)}&limit=${SEARCH_LIMIT}`
}

export function albumUrl(id: number): string {
  return `${ALBUM_URL}/${id}`
}

export function searchHit(payload: unknown, artist: string, track: string): SearchHit | null {
  if (isErrorPayload(payload))
    return null

  const results = isRecord(payload) ? payload.data : null

  if (!Array.isArray(results))
    return null

  for (const entry of results.slice(0, SEARCH_LIMIT)) {
    if (!isRecord(entry))
      continue

    const id = entry.id
    const title = entry.title
    const short = entry.title_short
    const name = isRecord(entry.artist) ? entry.artist.name : null
    const album = isRecord(entry.album) ? entry.album.title : null
    const albumId = isRecord(entry.album) && typeof entry.album.id === 'number' ? entry.album.id : null

    if (typeof id !== 'number' || typeof title !== 'string' || typeof name !== 'string')
      continue

    const label = typeof short === 'string' && short !== '' ? short : title

    // A search for "Daft Punk" happily answers a cover band. The song is only
    // this artist's when the billing agrees.
    if (!eitherContains(name, artist))
      continue

    // The artist agreeing is not the song agreeing: an obscure track or a live
    // version would borrow another song's album and year. title_short drops the
    // remaster suffix, so either label may name the parsed track.
    if (!eitherContains(label, track) && !eitherContains(title, track))
      continue

    return { id, artist: name, title: label, album: typeof album === 'string' ? album : null, albumId }
  }

  return null
}

function releaseFacts(raw: unknown): { releaseDate: string | null, year: number | null } {
  if (typeof raw !== 'string' || !RELEASE_DATE.test(raw))
    return { releaseDate: null, year: null }

  const [year = 0, month = 0, day = 0] = raw.split('-').map(Number)

  // Deezer answers "0000-00-00" when it does not know.
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31)
    return { releaseDate: null, year: null }

  return { releaseDate: raw, year }
}

export function albumFacts(payload: unknown, fallbackTitle: string | null): AlbumFacts {
  if (!isRecord(payload) || 'error' in payload)
    return { ...EMPTY_ALBUM, album: fallbackTitle }

  const title = typeof payload.title === 'string' ? payload.title : fallbackTitle
  const genres = isRecord(payload.genres) && Array.isArray(payload.genres.data) ? payload.genres.data : []
  const first: unknown = genres[0]
  const genre = isRecord(first) && typeof first.name === 'string' ? first.name : null

  return { album: title, genre, ...releaseFacts(payload.release_date) }
}
