import type { Clock } from '../core/clock.ts'
import type { Angle } from './angle.ts'
import { PREPARED_CLIP_TTL_MS } from '../limits.ts'

export interface PreparedClip {
  readonly songId: string
  // the facts the line was written from; a clip whose key no longer matches
  // the live queue says something false
  readonly key: string
  readonly file: string
  readonly angle: Angle
  readonly line: string
  readonly at: number
}

export interface TakenClip {
  readonly clip: PreparedClip | null
  // A clip that belonged to another song, other facts or sat past its TTL:
  // the caller owns the file and deletes it.
  readonly discarded: PreparedClip | null
}

export interface PreparedClips {
  preparedFor: (guildId: string, songId: string, key: string) => boolean
  // Returns the clip it replaced; the caller deletes that file.
  setPrepared: (guildId: string, clip: Omit<PreparedClip, 'at'>) => PreparedClip | null
  takePrepared: (guildId: string, songId: string, key: string) => TakenClip
  drop: (guildId: string) => PreparedClip | null
  clear: () => readonly PreparedClip[]
}

// One prepared line per guild, for one song and the facts it was written from.
export function preparedClips(clock: Clock): PreparedClips {
  const prepared = new Map<string, PreparedClip>()

  function drop(guildId: string): PreparedClip | null {
    const clip = prepared.get(guildId) ?? null

    prepared.delete(guildId)

    return clip
  }

  return {
    preparedFor(guildId, songId, key) {
      const stored = prepared.get(guildId)

      return stored?.songId === songId && stored.key === key
    },
    setPrepared(guildId, clip) {
      const previous = prepared.get(guildId) ?? null

      prepared.set(guildId, { ...clip, at: clock.now() })

      return previous
    },
    takePrepared(guildId, songId, key) {
      const stored = drop(guildId)

      if (stored === null)
        return { clip: null, discarded: null }

      const fresh = clock.now() - stored.at <= PREPARED_CLIP_TTL_MS

      if (stored.songId !== songId || stored.key !== key || !fresh)
        return { clip: null, discarded: stored }

      return { clip: stored, discarded: null }
    },
    drop,
    clear() {
      const clips = [...prepared.values()]

      prepared.clear()

      return clips
    },
  }
}
