import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { ListenersPort } from '../ports/listeners.ts'
import type { BeforeStreamInput, MusicEventMap, MusicPort, QueueView, Track } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { SongFactsPort } from '../ports/song-facts.ts'
import type { SpeechPort } from '../ports/speech.ts'
import { errorMessage } from '../core/errors.ts'
import { clipRemover, preparedClips } from './clips.ts'
import { clipKey, lineWriter, requesterOf } from './line.ts'
import { onAirStation, shouldSpeak } from './station.ts'

const PREFETCH = 3

export interface OnAirHost {
  beforeStream: (input: BeforeStreamInput) => Promise<void>
  trackQueued: (input: { guildId: string, track: Track, view: QueueView }) => void
  playlistQueued: (input: { guildId: string, view: QueueView }) => void
  trackStarted: (input: { guildId: string, view: QueueView }) => void
  stateChanged: (input: { guildId: string, view: QueueView }) => void
  trackSkipped: (input: MusicEventMap['trackSkipped']) => void
  playbackError: (input: { guildId: string, songId: string | null }) => void
  disconnected: (guildId: string) => void
  reset: (guildId: string) => void
  dispose: () => Promise<void>
}

export function onAirHost(deps: {
  music: MusicPort
  speech: SpeechPort
  model: ConversationPort | null
  settings: SettingsPort
  facts: SongFactsPort
  listeners: ListenersPort
  logger: Logger
  clock: Clock
}): OnAirHost {
  const { music, speech, facts, listeners, logger } = deps
  const station = onAirStation({ clock: deps.clock })
  const prepared = preparedClips(deps.clock)
  const writer = lineWriter(deps)
  const linesInFlight = new Set<string>()
  const preparing = new Set<string>()
  const remove = clipRemover(speech, logger)
  let disposed = false

  async function prepare(guildId: string, track: Track, view: QueueView): Promise<void> {
    if (disposed || !speech.available || !writer.ready())
      return

    if (preparing.has(guildId) || linesInFlight.has(guildId))
      return

    const onAir = station.songOnAir(guildId)

    if (onAir === null || onAir !== view.current?.id)
      return

    const nextView: QueueView = { ...view, current: track, upcoming: view.upcoming.slice(1) }
    const run = station.run(guildId)
    const key = clipKey(track, nextView, run)

    if (prepared.preparedFor(guildId, track.id, key))
      return

    if (!shouldSpeak(station.nextSongIndex(guildId), track.fromRadio))
      return

    preparing.add(guildId)

    let rewrite = false
    const stale = (): boolean => {
      if (disposed || station.songOnAir(guildId) !== onAir)
        return true

      const live = music.view(guildId) ?? view
      const next = live.upcoming[0]

      rewrite = next === undefined || clipKey(next, { upcoming: live.upcoming.slice(1), radio: live.radio }, station.run(guildId)) !== key

      return rewrite
    }

    try {
      const songFacts = await facts.lookup(track)

      if (stale())
        return

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

      if (written === null || stale())
        return

      const file = await speech.synthesize(written.text)

      if (file === null)
        return

      if (stale()) {
        await remove(file)

        return
      }

      const previous = prepared.setPrepared(guildId, { songId: track.id, key, file, angle: written.angle, text: written.text })

      if (previous)
        await remove(previous.file)
    }
    catch (error) {
      logger.error('on-air.prepare_failed', error, { guildId })
    }
    finally {
      preparing.delete(guildId)

      if (rewrite)
        prepareNext(guildId, null)
    }
  }

  function prepareNext(guildId: string, view: QueueView | null): void {
    if (disposed)
      return

    const live = music.view(guildId) ?? view
    const next = live?.upcoming[0]

    if (live && next)
      void prepare(guildId, next, live).catch(error => logger.error('on-air.prepare_failed', error, { guildId }))
  }

  async function beforeStream(input: BeforeStreamInput): Promise<void> {
    if (disposed)
      return

    const { guildId } = input
    const song = input.view.current

    if (!song)
      return

    const first = station.songOnAir(guildId) === null
    const run = station.run(guildId)
    const listener = first ? null : requesterOf(listeners, guildId, song)
    const speaks = shouldSpeak(station.recordSong(guildId, song), song.fromRadio)

    if (!song.fromRadio && song.requesterId !== null)
      listeners.recordRequest(guildId, { id: song.requesterId, name: song.requestedBy ?? '' }, { title: song.title, artist: song.artist })

    if (!speech.available || linesInFlight.has(guildId) || input.view.paused)
      return

    const { clip, discarded } = prepared.takePrepared(guildId, song.id, clipKey(song, input.view, run))

    if (!speaks) {
      await remove(discarded?.file ?? null)
      await remove(clip?.file ?? null)
      prepareNext(guildId, input.view)

      return
    }

    linesInFlight.add(guildId)

    let file = clip?.file ?? null

    try {
      await remove(discarded?.file ?? null)

      const written = clip ?? await writer.write({
        guildId,
        track: song,
        view: input.view,
        first,
        long: station.shouldUseLongLine(guildId),
        run,
        facts: first ? null : facts.cached(song),
        listener,
        lastAngle: station.lastAngle(guildId),
      })

      if (written === null)
        return

      file ??= await speech.synthesize(written.text)

      if (file === null)
        return

      if (await music.audio.playClip(guildId, file)) {
        logger.info('on-air.on_air', { guildId, track: song.title, angle: written.angle, line: written.text })
        station.recordLine(guildId)
        station.recordAngle(guildId, written.angle)
      }
      else {
        logger.info('on-air.clip_skipped', { guildId, track: song.title })
      }
    }
    catch (error) {
      logger.error('on-air.line_failed', error, { guildId })
    }
    finally {
      await remove(file)
      linesInFlight.delete(guildId)
      prepareNext(guildId, input.view)
    }
  }

  return {
    beforeStream,
    trackQueued({ guildId, track, view }) {
      if (!disposed && view.upcoming[0]?.id === track.id)
        void prepare(guildId, track, view).catch(error => logger.error('on-air.prepare_failed', error, { guildId }))
    },
    playlistQueued({ guildId, view }) {
      prepareNext(guildId, view)
    },
    trackStarted({ guildId, view }) {
      if (disposed)
        return

      for (const track of view.upcoming.slice(0, PREFETCH))
        void facts.lookup(track).catch(error => logger.warn('on-air.facts_failed', { guildId, track: track.title, error: errorMessage(error) }))
    },
    stateChanged({ guildId, view }) {
      prepareNext(guildId, view)
    },
    trackSkipped({ guildId, track, by }) {
      station.markSkipped(guildId, track.id, by.name)
    },
    playbackError({ guildId, songId }) {
      station.forgetFailed(guildId, songId)
    },
    disconnected(guildId) {
      station.endSession(guildId)
      void remove(prepared.drop(guildId)?.file ?? null)
    },
    reset(guildId) {
      station.reset(guildId)
      void remove(prepared.drop(guildId)?.file ?? null)
    },
    async dispose() {
      disposed = true

      const clips = prepared.clear()

      station.clear()
      linesInFlight.clear()
      preparing.clear()

      await Promise.all(clips.map(async clip => remove(clip.file)))
    },
  }
}
