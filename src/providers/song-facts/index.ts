import type { Logger } from '../../core/logger.ts'
import type { SongFacts, SongFactsPort, SongNews } from '../../ports/song-facts.ts'
import type { AlbumFacts, SearchHit } from './catalog.ts'
import type { ParsedTitle } from './title.ts'
import { withTimeout } from '../../core/async.ts'
import { errorMessage, TimeoutError } from '../../core/errors.ts'
import { parseJson } from '../../core/json.ts'
import { ttlMap } from '../../core/ttl-map.ts'
import { albumFacts, albumUrl, EMPTY_ALBUM, searchHit, searchUrl } from './catalog.ts'
import { artistPageUrl, artistSummary, pageHits, pageSummaryUrl, songSearchUrl, songSummary } from './encyclopedia.ts'
import { parseNews } from './news.ts'
import { cacheKey, parseTitle } from './title.ts'

const NEWS_URL = 'https://news.google.com/rss/search'
// Wikimedia's API policy refuses requests without a descriptive User-Agent.
const USER_AGENT = 'dj-discord-bot/1.0 (self-hosted Discord radio)'
const JSON_ACCEPT = 'application/json'
const XML_ACCEPT = 'application/rss+xml, application/xml;q=0.9, */*;q=0.8'
const DEFAULT_DEADLINE_MS = 8000
const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000
const PARTIAL_TTL_MS = 60 * 60 * 1000
const MAX_CACHED = 500

// Google News answers a bare name in any of its senses; the music terms keep the feed on bands.
const NEWS_TERMS = 'banda OR band OR music OR música OR song OR canción OR album OR disco OR concert OR show OR tour OR gira'

function newsUrl(artist: string): string {
  return `${NEWS_URL}?q=${encodeURIComponent(`"${artist}" (${NEWS_TERMS})`)}&hl=es-419&gl=AR&ceid=AR:es-419`
}

interface Collection {
  hit: SearchHit | null
  name: string | null
  track: string
  album: AlbumFacts
  bio: string | null
  song: string | null
  news: SongNews[]
  partial: boolean
}

interface Result {
  readonly facts: SongFacts | null
  readonly partial: boolean
}

function collect(parsed: ParsedTitle): Collection {
  return { hit: null, name: null, track: parsed.title, album: EMPTY_ALBUM, bio: null, song: null, news: [], partial: false }
}

function factsOf(state: Collection): SongFacts | null {
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

export function songFacts(deps: {
  logger: Logger
  fetch?: typeof fetch
  now?: () => number
  deadlineMs?: number
}): SongFactsPort {
  const { logger } = deps
  const get = deps.fetch ?? globalThis.fetch
  const now = deps.now ?? (() => Date.now())
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS

  const complete = ttlMap<string, SongFacts>({ ttlMs: COMPLETE_TTL_MS, max: MAX_CACHED, now })
  const partial = ttlMap<string, SongFacts>({ ttlMs: PARTIAL_TTL_MS, max: MAX_CACHED, now })
  const misses = ttlMap<string, null>({ ttlMs: PARTIAL_TTL_MS, max: MAX_CACHED, now })
  const pending = new Map<string, Promise<Result>>()

  async function getText(url: string, accept: string, signal: AbortSignal): Promise<string> {
    const response = await get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': accept },
      signal,
    })

    if (!response.ok)
      throw new Error(`Song facts request answered ${response.status}`)

    return response.text()
  }

  async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
    return parseJson(await getText(url, JSON_ACCEPT, signal))
  }

  async function attempt<T>(state: Collection, source: string, work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work()
    }
    catch (error) {
      state.partial = true
      logger.debug('song_facts.source_failed', { source, error: errorMessage(error) })

      return fallback
    }
  }

  async function songSummaryFor(track: string, artist: string, signal: AbortSignal): Promise<string | null> {
    const pages = pageHits(await getJson(songSearchUrl(track, artist), signal))

    for (const page of pages) {
      const found = songSummary(await getJson(pageSummaryUrl(page.key), signal), page.title, artist, track)

      if (found !== null)
        return found
    }

    return null
  }

  async function lookupFacts(parsed: ParsedTitle, artist: string, signal: AbortSignal, state: Collection): Promise<void> {
    const hit = await attempt(
      state,
      'deezer_search',
      async () => searchHit(await getJson(searchUrl(parsed.title, artist), signal), artist, parsed.title),
      null,
    )
    const name = hit?.artist ?? (parsed.explicit ? artist : null)

    state.hit = hit
    state.name = name

    if (name === null)
      return

    state.track = hit?.title ?? parsed.title

    const albumBase = { ...EMPTY_ALBUM, album: hit?.album ?? null }
    const albumId = hit?.albumId ?? null

    state.album = albumId === null
      ? albumBase
      : await attempt(
          state,
          'deezer_album',
          async () => albumFacts(await getJson(albumUrl(albumId), signal), albumBase.album),
          albumBase,
        )
    state.bio = hit === null
      ? null
      : await attempt(state, 'artist_summary', async () => artistSummary(await getJson(artistPageUrl(hit.artist), signal)), null)
    state.song = await attempt(state, 'song_summary', async () => songSummaryFor(state.track, name, signal), null)
    state.news = await attempt(
      state,
      'news',
      async () => parseNews(await getText(newsUrl(name), XML_ACCEPT, signal), name, now()),
      [],
    )
  }

  async function withinDeadline(parsed: ParsedTitle, artist: string): Promise<Result> {
    const state = collect(parsed)
    const controller = new AbortController()
    let timedOut = false

    try {
      await withTimeout(lookupFacts(parsed, artist, controller.signal, state), deadlineMs, 'Song facts deadline passed.')
    }
    catch (error) {
      if (!(error instanceof TimeoutError))
        throw error

      timedOut = true
      state.partial = true
    }
    finally {
      controller.abort()
    }

    if (timedOut)
      return { facts: state.hit === null ? null : factsOf(state), partial: true }

    const facts = state.hit === null && state.song === null && state.news.length === 0 ? null : factsOf(state)

    return { facts, partial: state.partial }
  }

  async function start(parsed: ParsedTitle, artist: string, key: string): Promise<Result> {
    const running = pending.get(key)

    if (running !== undefined)
      return running

    const work = withinDeadline(parsed, artist)
      .catch((error: unknown) => {
        logger.debug('song_facts.lookup_failed', {
          title: parsed.title,
          artist: parsed.artist,
          error: errorMessage(error),
        })

        return { facts: null, partial: true }
      })
      .then((result) => {
        if (result.facts === null)
          misses.set(key, null)
        else if (result.partial)
          partial.set(key, result.facts)
        else
          complete.set(key, result.facts)

        return result
      })
      .finally(() => {
        if (pending.get(key) === work)
          pending.delete(key)
      })

    pending.set(key, work)

    return work
  }

  async function lookup(input: { title: string, artist: string | null }): Promise<SongFacts | null> {
    const parsed = parseTitle(input.title, input.artist)

    if (parsed.artist === null) {
      logger.debug('song_facts.lookup_skipped', { title: parsed.title })

      return null
    }

    const key = cacheKey(parsed)
    const cached = complete.get(key) ?? partial.get(key)

    if (cached !== undefined)
      return cached

    if (misses.get(key) !== undefined)
      return null

    const result = await start(parsed, parsed.artist, key)

    return result.facts
  }

  function cached(input: { title: string, artist: string | null }): SongFacts | null {
    const parsed = parseTitle(input.title, input.artist)

    if (parsed.artist === null)
      return null

    const key = cacheKey(parsed)

    return complete.get(key) ?? partial.get(key) ?? null
  }

  return { lookup, cached }
}
