import type { Clock } from '../core/clock.ts'
import type { Angle } from './angle.ts'
import { RADIO_LONG_EVERY, RADIO_MEMORY_MS, RADIO_MEMORY_SIZE, RADIO_SILENT_EVERY, RADIO_SPEAK_EVERY } from '../limits.ts'

export interface StationSong {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly requestedBy: string | null
  readonly fromRadio: boolean
}

export interface PlayedEntry {
  readonly title: string
  readonly artist: string | null
  readonly requestedBy: string | null
  readonly fromRadio: boolean
  readonly skippedBy: string | null
}

interface PlayedSong extends StationSong, PlayedEntry {
  readonly at: number
}

export interface StationRun {
  readonly lastId: string | null
  readonly last: PlayedEntry | null
  readonly earlier: readonly PlayedEntry[]
}

const MAX_EARLIER = 3

export interface Station {
  recordSong: (guildId: string, song: StationSong) => number
  nextSongIndex: (guildId: string) => number
  songOnAir: (guildId: string) => string | null
  run: (guildId: string) => StationRun
  markSkipped: (guildId: string, songId: string, by: string) => void
  forgetFailed: (guildId: string, songId: string | null) => void
  shouldUseLongLine: (guildId: string) => boolean
  recordLine: (guildId: string) => void
  lastAngle: (guildId: string) => Angle | null
  recordAngle: (guildId: string, angle: Angle) => void
  endSession: (guildId: string) => void
  reset: (guildId: string) => void
  clear: () => void
}

export function shouldSpeak(index: number, fromRadio: boolean): boolean {
  return fromRadio ? index % RADIO_SPEAK_EVERY === 0 : index % RADIO_SILENT_EVERY !== 0
}

export function onAirStation(deps: { clock: Clock }): Station {
  const { clock } = deps
  const songs = new Map<string, { count: number, songId: string | null }>()
  const lines = new Map<string, number>()
  const history = new Map<string, PlayedSong[]>()
  const angles = new Map<string, Angle>()
  const failed = new Set<string>()

  function recent(guildId: string): readonly PlayedSong[] {
    const now = clock.now()

    return (history.get(guildId) ?? []).filter(song => now - song.at <= RADIO_MEMORY_MS)
  }

  return {
    recordSong(guildId, song) {
      const count = (songs.get(guildId)?.count ?? 0) + 1

      songs.set(guildId, { count, songId: song.id })
      failed.delete(guildId)

      const played = history.get(guildId) ?? []

      played.push({
        id: song.id,
        title: song.title,
        artist: song.artist,
        requestedBy: song.requestedBy,
        fromRadio: song.fromRadio,
        skippedBy: null,
        at: clock.now(),
      })
      history.set(guildId, played.slice(-RADIO_MEMORY_SIZE))

      return count
    },
    nextSongIndex(guildId) {
      return (songs.get(guildId)?.count ?? 0) + 1
    },
    songOnAir(guildId) {
      return songs.get(guildId)?.songId ?? null
    },
    run(guildId) {
      const played = recent(guildId).toReversed()
      const last = played[0] ?? null

      return {
        lastId: last?.id ?? null,
        last,
        earlier: played.slice(1, 1 + MAX_EARLIER),
      }
    },
    markSkipped(guildId, songId, by) {
      const played = history.get(guildId) ?? []
      const index = played.findLastIndex(song => song.id === songId)
      const song = played[index]

      if (song)
        played[index] = { ...song, skippedBy: by }
    },
    forgetFailed(guildId, songId) {
      const played = history.get(guildId) ?? []
      const onAir = songs.get(guildId)?.songId ?? null

      if (songId !== null && songId === onAir && !failed.has(guildId) && played.at(-1)?.id === onAir) {
        played.pop()
        failed.add(guildId)
      }
    },
    shouldUseLongLine(guildId) {
      return (lines.get(guildId) ?? 0) % RADIO_LONG_EVERY === 0
    },
    recordLine(guildId) {
      lines.set(guildId, (lines.get(guildId) ?? 0) + 1)
    },
    lastAngle(guildId) {
      return angles.get(guildId) ?? null
    },
    recordAngle(guildId, angle) {
      angles.set(guildId, angle)
    },
    endSession(guildId) {
      const counted = songs.get(guildId)

      if (counted)
        songs.set(guildId, { count: counted.count, songId: null })
    },
    reset(guildId) {
      lines.delete(guildId)
      songs.delete(guildId)
      history.delete(guildId)
      angles.delete(guildId)
      failed.delete(guildId)
    },
    clear() {
      songs.clear()
      lines.clear()
      history.clear()
      angles.clear()
      failed.clear()
    },
  }
}
