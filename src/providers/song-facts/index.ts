import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { SongFacts, SongFactsPort } from '../../ports/song-facts.ts'
import type { ParsedTitle } from './title.ts'
import { withTimeout } from '../../core/async.ts'
import { errorMessage, TimeoutError } from '../../core/errors.ts'
import { ttlMap } from '../../core/ttl-map.ts'
import { collect, factSources, factsOf } from './sources.ts'
import { cacheKey, parseTitle } from './title.ts'

const DEADLINE_MS = 8000
const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000
const PARTIAL_TTL_MS = 60 * 60 * 1000
const MAX_CACHED = 500

interface Result {
  readonly facts: SongFacts | null
  readonly partial: boolean
}

export function songFacts(deps: { logger: Logger; clock: Clock }): SongFactsPort {
  const { logger, clock } = deps
  const sources = factSources({ logger, clock })

  const complete = ttlMap<string, SongFacts>({ ttlMs: COMPLETE_TTL_MS, max: MAX_CACHED, clock })
  const partial = ttlMap<string, SongFacts>({ ttlMs: PARTIAL_TTL_MS, max: MAX_CACHED, clock })
  const misses = ttlMap<string, null>({ ttlMs: PARTIAL_TTL_MS, max: MAX_CACHED, clock })
  const pending = new Map<string, Promise<Result>>()

  async function withinDeadline(parsed: ParsedTitle, artist: string): Promise<Result> {
    const state = collect(parsed)
    const controller = new AbortController()
    let timedOut = false

    try {
      await withTimeout(
        sources.read(state, parsed, artist, controller.signal),
        DEADLINE_MS,
        'Song facts deadline passed.',
      )
    } catch (error) {
      if (!(error instanceof TimeoutError)) {
        throw error
      }

      timedOut = true
      state.partial = true
    } finally {
      controller.abort()
    }

    if (timedOut) {
      return { facts: state.hit === null ? null : factsOf(state), partial: true }
    }

    const facts =
      state.hit === null && state.song === null && state.news.length === 0 ? null : factsOf(state)

    return { facts, partial: state.partial }
  }

  async function start(parsed: ParsedTitle, artist: string, key: string): Promise<Result> {
    const running = pending.get(key)

    if (running !== undefined) {
      return running
    }

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
        if (result.facts === null) {
          misses.set(key, null)
        } else if (result.partial) {
          partial.set(key, result.facts)
        } else {
          complete.set(key, result.facts)
        }

        return result
      })
      .finally(() => {
        if (pending.get(key) === work) {
          pending.delete(key)
        }
      })

    pending.set(key, work)

    return work
  }

  async function lookup(input: {
    title: string
    artist: string | null
  }): Promise<SongFacts | null> {
    const parsed = parseTitle(input.title, input.artist)

    if (parsed.artist === null) {
      logger.debug('song_facts.lookup_skipped', { title: parsed.title })

      return null
    }

    const key = cacheKey(parsed)
    const cached = complete.get(key) ?? partial.get(key)

    if (cached !== undefined) {
      return cached
    }

    if (misses.get(key) !== undefined) {
      return null
    }

    const result = await start(parsed, parsed.artist, key)

    return result.facts
  }

  function cached(input: { title: string; artist: string | null }): SongFacts | null {
    const parsed = parseTitle(input.title, input.artist)

    if (parsed.artist === null) {
      return null
    }

    const key = cacheKey(parsed)

    return complete.get(key) ?? partial.get(key) ?? null
  }

  return { lookup, cached }
}
