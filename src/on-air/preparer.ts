import type { Logger } from '../core/logger.ts'
import type { ListenersPort } from '../ports/listeners.ts'
import type { MusicPort, QueueView, Track } from '../ports/music.ts'
import type { SongFactsPort } from '../ports/song-facts.ts'
import type { SpeechPort } from '../ports/speech.ts'
import type { PreparedClips } from './clips.ts'
import type { LineWriter } from './line.ts'
import type { Station } from './station.ts'
import { clipKey, requesterOf } from './line.ts'
import { shouldSpeak } from './station.ts'

interface ClipPreparer {
  prepare: (guildId: string, track: Track, view: QueueView) => void
  prepareNext: (guildId: string, view: QueueView | null) => void
  dispose: () => void
}

export function clipPreparer(deps: {
  music: MusicPort
  speech: SpeechPort
  facts: SongFactsPort
  listeners: ListenersPort
  logger: Logger
  station: Station
  prepared: PreparedClips
  writer: LineWriter
  linesInFlight: ReadonlySet<string>
  remove: (file: string | null) => Promise<void>
}): ClipPreparer {
  const { music, speech, facts, listeners, logger, station, prepared, writer, remove } = deps
  const preparing = new Set<string>()
  let disposed = false

  async function prepareClip(guildId: string, track: Track, view: QueueView): Promise<void> {
    if (disposed || !speech.available || !writer.ready()) {
      return
    }

    if (preparing.has(guildId) || deps.linesInFlight.has(guildId)) {
      return
    }

    const onAir = station.songOnAir(guildId)

    if (onAir === null || onAir !== view.current?.id) {
      return
    }

    const nextView: QueueView = { ...view, current: track, upcoming: view.upcoming.slice(1) }
    const run = station.run(guildId)
    const key = clipKey(track, nextView, run)

    if (prepared.preparedFor(guildId, track.id, key)) {
      return
    }

    if (!shouldSpeak(station.nextSongIndex(guildId), track.fromRadio)) {
      return
    }

    preparing.add(guildId)

    let rewrite = false
    const stale = (): boolean => {
      if (disposed || station.songOnAir(guildId) !== onAir) {
        return true
      }

      const live = music.view(guildId) ?? view
      const next = live.upcoming[0]

      rewrite =
        next === undefined ||
        clipKey(
          next,
          { upcoming: live.upcoming.slice(1), radio: live.radio },
          station.run(guildId),
        ) !== key

      return rewrite
    }

    try {
      const songFacts = await facts.lookup(track)

      if (stale()) {
        return
      }

      const written = await writer.write({
        guildId,
        track,
        view: nextView,
        first: false,
        long: station.shouldUseLongLine(guildId),
        run,
        facts: songFacts,
        listener: requesterOf(listeners, guildId, track),
        lastAngle: station.lastAngle(guildId),
      })

      if (written === null || stale()) {
        return
      }

      const file = await speech.synthesize(written.text)

      if (file === null) {
        return
      }

      if (stale()) {
        await remove(file)

        return
      }

      const previous = prepared.setPrepared(guildId, {
        songId: track.id,
        key,
        file,
        angle: written.angle,
        text: written.text,
      })

      if (previous) {
        await remove(previous.file)
      }
    } catch (error) {
      logger.error('on-air.prepare_failed', error, { guildId })
    } finally {
      preparing.delete(guildId)

      if (rewrite) {
        prepareNext(guildId, null)
      }
    }
  }

  function prepare(guildId: string, track: Track, view: QueueView): void {
    void prepareClip(guildId, track, view).catch((error: unknown) =>
      logger.error('on-air.prepare_failed', error, { guildId }),
    )
  }

  function prepareNext(guildId: string, view: QueueView | null): void {
    if (disposed) {
      return
    }

    const live = music.view(guildId) ?? view
    const next = live?.upcoming[0]

    if (live && next) {
      prepare(guildId, next, live)
    }
  }

  return {
    prepare,
    prepareNext,
    dispose() {
      disposed = true
      preparing.clear()
    },
  }
}
