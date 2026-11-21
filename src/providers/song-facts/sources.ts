import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { SongFacts, SongNews } from '../../ports/song-facts.ts'
import type { AlbumFacts, SearchHit } from './catalog.ts'
import type { ParsedTitle } from './title.ts'
import type { Json } from '../../core/json.ts'
import { errorMessage } from '../../core/errors.ts'
import { parseJson } from '../../core/json.ts'
import { albumFacts, albumUrl, EMPTY_ALBUM, searchHit, searchUrl } from './catalog.ts'
import {
  artistPageUrl,
  artistSummary,
  pageHits,
  pageSummaryUrl,
  songSearchUrl,
  songSummary,
} from './encyclopedia.ts'
import { parseNews } from './news.ts'

const NEWS_URL = 'https://news.google.com/rss/search'
const DESCRIBED_USER_AGENT = 'dj-discord-bot/1.0 (self-hosted Discord radio)'
const JSON_ACCEPT = 'application/json'
const XML_ACCEPT = 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
const NEWS_TERMS =
  'banda OR band OR music OR música OR song OR canción OR album OR disco OR concert OR show OR tour OR gira'

function newsUrl(artist: string): string {
  return `${NEWS_URL}?q=${encodeURIComponent(`"${artist}" (${NEWS_TERMS})`)}&hl=es-419&gl=AR&ceid=AR:es-419`
}

export interface Collection {
  hit: SearchHit | null
  name: string | null
  track: string
  album: AlbumFacts
  bio: string | null
  song: string | null
  news: Array<SongNews>
  partial: boolean
}

export function collect(parsed: ParsedTitle): Collection {
  return {
    hit: null,
    name: null,
    track: parsed.title,
    album: EMPTY_ALBUM,
    bio: null,
    song: null,
    news: [],
    partial: false,
  }
}

export function factsOf(state: Collection): SongFacts | null {
  if (state.name === null) {
    return null
  }

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

async function getText(url: string, accept: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': DESCRIBED_USER_AGENT, Accept: accept },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Song facts request answered ${response.status}`)
  }

  return response.text()
}

async function getJson(url: string, signal: AbortSignal): Promise<Json> {
  return parseJson(await getText(url, JSON_ACCEPT, signal))
}

async function songSummaryFor(
  track: string,
  artist: string,
  signal: AbortSignal,
): Promise<string | null> {
  const pages = pageHits(await getJson(songSearchUrl(track, artist), signal))

  for (const page of pages) {
    const found = songSummary(
      await getJson(pageSummaryUrl(page.key), signal),
      page.title,
      artist,
      track,
    )

    if (found !== null) {
      return found
    }
  }

  return null
}

export function factSources(deps: { logger: Logger; clock: Clock }) {
  const { logger, clock } = deps

  async function attempt<T>(
    state: Collection,
    source: string,
    work: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await work()
    } catch (error) {
      state.partial = true
      logger.debug('song_facts.source_failed', { source, error: errorMessage(error) })

      return fallback
    }
  }

  async function read(
    state: Collection,
    parsed: ParsedTitle,
    artist: string,
    signal: AbortSignal,
  ): Promise<void> {
    const hit = await attempt(
      state,
      'deezer_search',
      async () =>
        searchHit(await getJson(searchUrl(parsed.title, artist), signal), artist, parsed.title),
      null,
    )
    const name = hit?.artist ?? (parsed.explicit ? artist : null)

    state.hit = hit
    state.name = name

    if (name === null) {
      return
    }

    state.track = hit?.title ?? parsed.title

    const albumBase = { ...EMPTY_ALBUM, album: hit?.album ?? null }
    const albumId = hit?.albumId ?? null

    state.album =
      albumId === null
        ? albumBase
        : await attempt(
            state,
            'deezer_album',
            async () => albumFacts(await getJson(albumUrl(albumId), signal), albumBase.album),
            albumBase,
          )
    state.bio =
      hit === null
        ? null
        : await attempt(
            state,
            'artist_summary',
            async () => artistSummary(await getJson(artistPageUrl(hit.artist), signal)),
            null,
          )
    state.song = await attempt(
      state,
      'song_summary',
      async () => songSummaryFor(state.track, name, signal),
      null,
    )
    state.news = await attempt(
      state,
      'news',
      async () => parseNews(await getText(newsUrl(name), XML_ACCEPT, signal), name, clock.now()),
      [],
    )
  }

  return { read }
}
