import type { SongFacts, SongNews } from '../../ports/song-facts.ts'
import type { AlbumFacts, SearchHit } from './catalog.ts'
import type { ParsedTitle } from './title.ts'
import { EMPTY_ALBUM } from './catalog.ts'

// What the lookup has gathered so far. One object survives a deadline so the
// work already paid for is not thrown away with the timeout.
export interface Collection {
  hit: SearchHit | null
  name: string | null
  track: string
  album: AlbumFacts
  bio: string | null
  song: string | null
  news: SongNews[]
  partial: boolean
}

export interface Result {
  readonly facts: SongFacts | null
  readonly partial: boolean
}

export function collect(parsed: ParsedTitle): Collection {
  return { hit: null, name: null, track: parsed.title, album: EMPTY_ALBUM, bio: null, song: null, news: [], partial: false }
}

export function factsOf(state: Collection): SongFacts | null {
  if (state.name === null)
    return null

  return {
    artist: state.name,
    title: state.track,
    album: state.album.album,
    year: state.album.year,
    releaseDate: state.album.releaseDate,
    genre: state.album.genre,
    artistSummary: state.bio,
    songSummary: state.song,
    news: state.news,
  }
}
