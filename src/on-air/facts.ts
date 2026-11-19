import type { Logger } from '../core/logger.ts'
import type { QueueView, Track } from '../ports/music.ts'
import type { SongFacts, SongFactsPort } from '../ports/song-facts.ts'
import { errorMessage } from '../core/errors.ts'

const PREFETCH = 3

export interface FactsReader {
  // for a line prepared while a song plays
  lookup: (track: Track) => Promise<SongFacts | null>
  // for a line written in the gap, which never waits for the network
  cached: (track: Track) => SongFacts | null
  // facts for the next songs, fetched while this one plays, so a line written
  // live after a skip or a shuffle finds them in the cache
  prefetch: (view: QueueView) => void
}

export function factsReader(facts: SongFactsPort, logger: Logger): FactsReader {
  function failed(track: Track, error: unknown): null {
    logger.warn('on-air.facts_failed', { track: track.title, error: errorMessage(error) })

    return null
  }

  return {
    async lookup(track) {
      try {
        return await facts.lookup({ title: track.title, artist: track.artist })
      }
      catch (error) {
        return failed(track, error)
      }
    },
    cached(track) {
      try {
        return facts.cached({ title: track.title, artist: track.artist })
      }
      catch (error) {
        return failed(track, error)
      }
    },
    prefetch(view) {
      for (const track of view.upcoming.slice(0, PREFETCH)) {
        try {
          void facts.lookup({ title: track.title, artist: track.artist }).catch(() => {})
        }
        catch {}
      }
    },
  }
}
