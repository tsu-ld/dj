import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { ListenersPort } from '../ports/listeners.ts'
import type { BeforeStreamInput, MusicEventMap, MusicPort, QueueView, Track } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { SongFactsPort } from '../ports/song-facts.ts'
import type { SpeechPort } from '../ports/speech.ts'
import { factsReader } from './facts.ts'
import { clipRemover, queueReader } from './io.ts'
import { clipKey, lineWriter, requesterOf } from './line.ts'
import { onAirStation, shouldSpeak } from './station.ts'

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
  const { music, speech, listeners, logger } = deps
  const facts = factsReader(deps.facts, logger)
  const station = onAirStation({ clock: deps.clock })
  const writer = lineWriter(deps)
  const linesInFlight = new Set<string>()
  const preparing = new Set<string>()
  const remove = clipRemover(speech, logger)
  const liveView = queueReader(music, logger)
  let disposed = false

  // The next line is written while the current song plays, so the only silence
  // between songs is the line itself, not the lookups, the model and the
  // synthesis.
  async function prepare(guildId: string, track: Track, view: QueueView): Promise<void> {
    if (disposed || !speech.available || !writer.ready())
      return

    if (preparing.has(guildId) || linesInFlight.has(guildId))
      return

    const onAir = station.songOnAir(guildId)

    // A playlist is added before its first song goes on air; preparing then
    // would read the cadence before that song took its slot.
    if (onAir === null || onAir !== view.current?.id)
      return

    // The prompt talks about the song that will be on air, so the queue view
    // is shifted to make that song the current one. The song on air is assumed
    // to play through; a skip changes the key and the line is written live.
    const nextView: QueueView = { ...view, current: track, upcoming: view.upcoming.slice(1) }
    const run = station.run(guildId)
    const key = clipKey(track, nextView, run)

    if (station.preparedFor(guildId, track.id, key))
      return

    // Do not spend a lookup, a model call and a synthesis on a silent song.
    if (!shouldSpeak(station.nextSongIndex(guildId), track.fromRadio))
      return

    preparing.add(guildId)

    // A new song on air: the line belongs to a song that will not play. A new
    // queue or run: the line says something false and is written again.
    let rewrite = false
    const stale = (): boolean => {
      if (disposed || station.songOnAir(guildId) !== onAir)
        return true

      const live = liveView(guildId) ?? view
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
        listener: requesterOf(listeners, guildId, track, deps.clock.now()),
        lastAngle: station.lastAngle(guildId),
      })

      // A stale line never pays for the synthesis.
      if (written === null || stale())
        return

      const file = await speech.synthesize(written.text)

      if (file === null)
        return

      if (stale()) {
        await remove(file)

        return
      }

      const previous = station.setPrepared(guildId, { songId: track.id, key, file, angle: written.angle, line: written.text })

      if (previous)
        await remove(previous.file)
    }
    catch (error) {
      logger.error('on-air.prepare_failed', error, { guildId })
    }
    finally {
      preparing.delete(guildId)

      // The change that made the line stale found this prepare running and
      // returned early; nothing else would write the line again.
      if (rewrite)
        prepareNext(guildId, null)
    }
  }

  function prepareNext(guildId: string, view: QueueView | null): void {
    if (disposed)
      return

    // The old hook read the queue again in its finally block: a song removed
    // while the line was airing must not be the one prepared next.
    const live = liveView(guildId) ?? view
    const next = live?.upcoming[0]

    if (live && next)
      void prepare(guildId, next, live).catch(error => logger.error('on-air.prepare_failed', error, { guildId }))
  }

  // Called before a song starts: the stream waits for this hook, so the line
  // lands in the gap like a radio host and never on top of the music.
  async function beforeStream(input: BeforeStreamInput): Promise<void> {
    if (disposed)
      return

    // The line belongs to the song on the now-playing card, not to the search
    // result the stream resolved behind it. No card means nothing to announce.
    const { guildId } = input
    const song = input.view.current

    if (!song)
      return

    // Captured before the song is recorded: the run is what played before it,
    // and the profile counts the requests before this one. The request is
    // recorded here, not when the song starts, because the next song's line is
    // prepared right after this hook. An unnamed skip wins over a silent slot;
    // a line still airing defers it while the skipped song is still the last.
    const first = station.firstOfSession(guildId)
    const run = station.run(guildId)
    const listener = first ? null : requesterOf(listeners, guildId, song, deps.clock.now())
    const index = station.recordSong(guildId, song)
    const speaks = shouldSpeak(index, song.fromRadio) || (!first && run.skipPending)

    if (!song.fromRadio && song.requesterId !== null)
      listeners.recordRequest(guildId, { id: song.requesterId, name: song.requestedBy ?? '' }, { title: song.title, artist: song.artist })

    if (!speech.available || linesInFlight.has(guildId) || input.view.paused)
      return

    const { clip, discarded } = station.takePrepared(guildId, song.id, clipKey(song, input.view, run))

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

      // A prepared line is the fast path. The first song, autoplay songs and a
      // stale clip get one written here, from what is already known.
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
      }).then(line => line && { angle: line.angle, line: line.text })

      if (written === null)
        return

      file ??= await speech.synthesize(written.line)

      if (file === null)
        return

      if (await music.audio.playClip(guildId, file)) {
        logger.info('on-air.on_air', { guildId, track: song.title, angle: written.angle, line: written.line })
        station.recordLine(guildId)
        station.recordAngle(guildId, written.angle)

        if (written.angle === 'skip' && run.last !== null)
          station.markSkipAnnounced(guildId, run.last)
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

  function drop(clip: { file: string } | null): void {
    if (clip)
      void remove(clip.file)
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
    trackStarted({ view }) {
      if (!disposed)
        facts.prefetch(view)
    },
    // A shuffle, a removal or an addition changes what the line may say; the
    // prepare is skipped when the key still matches.
    stateChanged({ guildId, view }) {
      prepareNext(guildId, view)
    },
    // The next song starts right away: a prepare would only race its live line.
    trackSkipped({ guildId, track, by, playedMs }) {
      station.markSkipped(guildId, track.id, by.name, playedMs)
    },
    playbackError({ guildId, songId }) {
      station.forgetFailed(guildId, songId)
    },
    disconnected(guildId) {
      drop(station.endSession(guildId))
    },
    reset(guildId) {
      drop(station.reset(guildId))
    },
    async dispose() {
      disposed = true

      const clips = station.clear()

      linesInFlight.clear()
      preparing.clear()

      await Promise.all(clips.map(async clip => remove(clip.file)))
    },
  }
}
