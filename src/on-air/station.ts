import type { Clock } from '../core/clock.ts'
import { PREPARED_CLIP_TTL_MS, RADIO_LONG_EVERY, RADIO_SILENT_EVERY, RADIO_SPEAK_EVERY } from '../limits.ts'

export interface PreparedClip {
  readonly songId: string
  readonly file: string
  readonly at: number
}

export interface TakenClip {
  readonly clip: PreparedClip | null
  // A clip that belonged to another song or sat past its TTL: the caller owns
  // the file and deletes it.
  readonly discarded: PreparedClip | null
}

export interface Station {
  recordSong: (guildId: string, songId: string) => number
  nextSongIndex: (guildId: string) => number
  songOnAir: (guildId: string) => string | null
  shouldUseLongLine: (guildId: string) => boolean
  recordLine: (guildId: string) => void
  endSession: (guildId: string) => PreparedClip | null
  reset: (guildId: string) => PreparedClip | null
  preparedFor: (guildId: string, songId: string) => boolean
  setPrepared: (guildId: string, clip: { songId: string, file: string }) => PreparedClip | null
  takePrepared: (guildId: string, songId: string) => TakenClip
  clear: () => readonly PreparedClip[]
}

// Every third requested song stays silent. Autoplay songs invert the cadence:
// only one in three speaks, so the radio runs mostly music.
export function shouldSpeak(index: number, fromRadio = false): boolean {
  return fromRadio ? index % RADIO_SPEAK_EVERY === 0 : index % RADIO_SILENT_EVERY !== 0
}

export function onAirStation(deps: { clock: Clock }): Station {
  const { clock } = deps
  const songs = new Map<string, { count: number, songId: string | null }>()
  const lines = new Map<string, number>()
  const prepared = new Map<string, PreparedClip>()

  function dropPrepared(guildId: string): PreparedClip | null {
    const clip = prepared.get(guildId) ?? null

    prepared.delete(guildId)

    return clip
  }

  return {
    recordSong(guildId, songId) {
      const count = (songs.get(guildId)?.count ?? 0) + 1

      songs.set(guildId, { count, songId })

      return count
    },
    nextSongIndex(guildId) {
      return (songs.get(guildId)?.count ?? 0) + 1
    },
    songOnAir(guildId) {
      return songs.get(guildId)?.songId ?? null
    },
    // A real station opens with a proper rant and then keeps the song intros
    // short; every fifth line gets long again so it does not become background
    // noise.
    shouldUseLongLine(guildId) {
      return (lines.get(guildId) ?? 0) % RADIO_LONG_EVERY === 0
    },
    recordLine(guildId) {
      lines.set(guildId, (lines.get(guildId) ?? 0) + 1)
    },
    // Ending a session drops the audio prepared for a song that will not play
    // and forgets the song that was on air. The cadence counters live on: a
    // listener who asks for one song at a time would otherwise get a line
    // before every single one.
    endSession(guildId) {
      const counted = songs.get(guildId)

      if (counted)
        songs.set(guildId, { count: counted.count, songId: null })

      return dropPrepared(guildId)
    },
    // Clearing the queue is a hard stop: the next request starts fresh.
    reset(guildId) {
      lines.delete(guildId)
      songs.delete(guildId)

      return dropPrepared(guildId)
    },
    preparedFor(guildId, songId) {
      return prepared.get(guildId)?.songId === songId
    },
    // Returns the clip it replaced; the caller deletes that file.
    setPrepared(guildId, clip) {
      const previous = prepared.get(guildId) ?? null

      prepared.set(guildId, { songId: clip.songId, file: clip.file, at: clock.now() })

      return previous
    },
    takePrepared(guildId, songId) {
      const stored = prepared.get(guildId)

      if (!stored)
        return { clip: null, discarded: null }

      prepared.delete(guildId)

      const fresh = clock.now() - stored.at <= PREPARED_CLIP_TTL_MS

      if (stored.songId !== songId || !fresh)
        return { clip: null, discarded: stored }

      return { clip: stored, discarded: null }
    },
    clear() {
      const clips = [...prepared.values()]

      prepared.clear()
      songs.clear()
      lines.clear()

      return clips
    },
  }
}
