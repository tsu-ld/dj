import type { Clock } from '../core/clock.ts'
import type { Angle } from './angle.ts'
import type { PreparedClip, PreparedClips } from './clips.ts'
import { RADIO_LONG_EVERY, RADIO_MEMORY_MS, RADIO_MEMORY_SIZE, RADIO_SILENT_EVERY, RADIO_SPEAK_EVERY } from '../limits.ts'
import { preparedClips } from './clips.ts'

export interface StationSong {
  readonly id: string
  readonly title: string
  readonly artist: string | null
  readonly requestedBy: string | null
  readonly requesterId: string | null
  readonly fromRadio: boolean
}

// A song in the run, as the line talks about it.
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

// What played before the song about to go on air, newest first.
export interface StationRun {
  readonly lastId: string | null
  readonly last: PlayedEntry | null
  // at most MAX_EARLIER songs
  readonly earlier: readonly PlayedEntry[]
}

const MAX_EARLIER = 3

export interface Station extends Pick<PreparedClips, 'preparedFor' | 'setPrepared' | 'takePrepared'> {
  recordSong: (guildId: string, song: StationSong) => number
  nextSongIndex: (guildId: string) => number
  songOnAir: (guildId: string) => string | null
  firstOfSession: (guildId: string) => boolean
  run: (guildId: string) => StationRun
  markSkipped: (guildId: string, songId: string, by: string) => void
  forgetFailed: (guildId: string, songId: string | null) => void
  shouldUseLongLine: (guildId: string) => boolean
  recordLine: (guildId: string) => void
  lastAngle: (guildId: string) => Angle | null
  recordAngle: (guildId: string, angle: Angle) => void
  endSession: (guildId: string) => PreparedClip | null
  reset: (guildId: string) => PreparedClip | null
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
  const prepared = preparedClips(clock)
  const history = new Map<string, PlayedSong[]>()
  const angles = new Map<string, Angle>()
  // guilds whose song on air already left the run after a failure
  const failed = new Set<string>()

  // Old enough records are forgotten: a line after a long pause must not
  // pretend the station kept playing.
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

      // The run is a rolling window: the line talks about the last songs, not
      // about everything that ever played.
      played.push({
        id: song.id,
        title: song.title,
        artist: song.artist,
        requestedBy: song.requestedBy,
        requesterId: song.requesterId,
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
    // Nothing went on air since the start, a disconnect or a reset.
    firstOfSession(guildId) {
      return (songs.get(guildId)?.songId ?? null) === null
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
    // The newest play of that song: a repeat must not mark the earlier one.
    markSkipped(guildId, songId, by) {
      const played = history.get(guildId) ?? []
      const index = played.findLastIndex(song => song.id === songId)
      const song = played[index]

      if (song)
        played[index] = { ...song, skippedBy: by }
    },
    // A song whose stream failed never played: it leaves the run so no line
    // back-announces it. It keeps its cadence slot and stays the song on air
    // until the next one, so the next line is not a welcome. A song that
    // failed before it went on air was never recorded, and the one on air
    // played: only the reported song is dropped.
    forgetFailed(guildId, songId) {
      const played = history.get(guildId) ?? []
      const onAir = songs.get(guildId)?.songId ?? null

      // A second error for the same song must not drop the one before it.
      if (songId !== null && songId === onAir && !failed.has(guildId) && played.at(-1)?.id === onAir) {
        played.pop()
        failed.add(guildId)
      }
    },
    // A real station opens with a proper rant and then keeps the song intros
    // short; every second line gets long again so it does not become
    // background noise.
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
    // Ending a session drops the audio prepared for a song that will not play
    // and forgets the song that was on air. The cadence counters live on: a
    // listener who asks for one song at a time would otherwise get a line
    // before every single one. The recent songs stay for a while, so the first
    // line after a reconnect can pick up the thread.
    endSession(guildId) {
      const counted = songs.get(guildId)

      if (counted)
        songs.set(guildId, { count: counted.count, songId: null })

      return prepared.drop(guildId)
    },
    // Clearing the queue is a hard stop: the next request starts fresh.
    reset(guildId) {
      lines.delete(guildId)
      songs.delete(guildId)
      history.delete(guildId)
      angles.delete(guildId)
      failed.delete(guildId)

      return prepared.drop(guildId)
    },
    preparedFor: prepared.preparedFor,
    setPrepared: prepared.setPrepared,
    takePrepared: prepared.takePrepared,
    clear() {
      const clips = prepared.clear()

      songs.clear()
      lines.clear()
      history.clear()
      angles.clear()
      failed.clear()

      return clips
    },
  }
}
