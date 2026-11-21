import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { SpeechPort } from '../ports/speech.ts'
import type { Angle } from './angle.ts'
import { rm } from 'node:fs/promises'
import { errorMessage } from '../core/errors.ts'
import { PREPARED_CLIP_TTL_MS } from '../limits.ts'

interface PreparedClip {
  readonly songId: string
  readonly key: string
  readonly file: string
  readonly angle: Angle
  readonly text: string
  readonly at: number
}

interface TakenClip {
  readonly clip: PreparedClip | null
  readonly discarded: PreparedClip | null
}

export interface PreparedClips {
  preparedFor: (guildId: string, songId: string, key: string) => boolean
  setPrepared: (guildId: string, clip: Omit<PreparedClip, 'at'>) => PreparedClip | null
  takePrepared: (guildId: string, songId: string, key: string) => TakenClip
  drop: (guildId: string) => PreparedClip | null
  clear: () => ReadonlyArray<PreparedClip>
}

export function preparedClips(clock: Clock): PreparedClips {
  const prepared = new Map<string, PreparedClip>()

  function holds(clip: PreparedClip | undefined, songId: string, key: string): boolean {
    return clip?.songId === songId && clip.key === key
  }

  function drop(guildId: string): PreparedClip | null {
    const clip = prepared.get(guildId) ?? null

    prepared.delete(guildId)

    return clip
  }

  return {
    preparedFor(guildId, songId, key) {
      return holds(prepared.get(guildId), songId, key)
    },
    setPrepared(guildId, clip) {
      const previous = prepared.get(guildId) ?? null

      prepared.set(guildId, { ...clip, at: clock.now() })

      return previous
    },
    takePrepared(guildId, songId, key) {
      const stored = drop(guildId)

      if (stored === null) {
        return { clip: null, discarded: null }
      }

      const fresh = clock.now() - stored.at <= PREPARED_CLIP_TTL_MS

      if (!holds(stored, songId, key) || !fresh) {
        return { clip: null, discarded: stored }
      }

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

export function clipRemover(
  speech: SpeechPort,
  logger: Logger,
): (file: string | null) => Promise<void> {
  return async (file) => {
    if (file === null) {
      return
    }

    try {
      await rm(file, { force: true })
      speech.release(file)
    } catch (error) {
      logger.warn('on-air.clip_delete_failed', { file, error: errorMessage(error) })
    }
  }
}
