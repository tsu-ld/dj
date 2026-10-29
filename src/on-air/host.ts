import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { BeforeStreamInput, MusicPort, QueueView, Track } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { SpeechPort } from '../ports/speech.ts'
import { rm } from 'node:fs/promises'
import { errorMessage } from '../core/errors.ts'
import { buildOnAirPrompt, lineLimit, lineRequest, sanitizeLine } from './script.ts'
import { onAirStation, shouldSpeak } from './station.ts'

const LINE_TIMEOUT_MS = 8_000
// The model reasons before answering and the reasoning counts against this cap:
// with 160 it produced only reasoning, and with 600 it sometimes burned the
// whole budget thinking and returned no line at all.
const LINE_MAX_OUTPUT_TOKENS = 1_200

export interface OnAirHost {
  beforeStream: (input: BeforeStreamInput) => Promise<void>
  trackQueued: (input: { guildId: string, track: Track, view: QueueView }) => void
  playlistQueued: (input: { guildId: string, view: QueueView }) => void
  disconnected: (guildId: string) => void
  reset: (guildId: string) => void
  dispose: () => Promise<void>
}

export function onAirHost(deps: {
  music: MusicPort
  speech: SpeechPort
  model: ConversationPort | null
  settings: SettingsPort
  logger: Logger
  clock: Clock
}): OnAirHost {
  const { music, speech, model, settings, logger, clock } = deps
  const station = onAirStation({ clock })
  const linesInFlight = new Set<string>()
  const preparing = new Set<string>()
  let disposed = false

  async function remove(file: string | null): Promise<void> {
    if (file === null)
      return

    try {
      await rm(file, { force: true })
      speech.release(file)
    }
    catch (error) {
      // The provider keeps the path so dispose can retry the delete.
      logger.warn('on-air.clip_delete_failed', { file, error: errorMessage(error) })
    }
  }

  function liveView(guildId: string): QueueView | null {
    try {
      return music.view(guildId)
    }
    catch (error) {
      logger.warn('on-air.view_failed', { guildId, error: errorMessage(error) })

      return null
    }
  }

  // The model occasionally spends the whole budget on reasoning and answers
  // with nothing; one retry is cheaper than a silent transition.
  async function generateLine(guildId: string, track: Track, view: QueueView): Promise<string | null> {
    if (!model || !speech.available)
      return null

    const long = station.shouldUseLongLine(guildId)
    const maxChars = lineLimit(long)
    const instructions = buildOnAirPrompt({
      settings: settings.get(guildId),
      track,
      view,
      long,
    })

    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await model.complete({
        instructions,
        messages: [{ role: 'user', content: lineRequest(long) }],
        timeoutMs: LINE_TIMEOUT_MS,
        maxOutputTokens: LINE_MAX_OUTPUT_TOKENS,
        // Radio lines are short and live; thinking only adds seconds of silence.
        reasoning: 'none',
        sessionId: `voice:${guildId}`,
      })
      const line = sanitizeLine(reply.text, maxChars)

      // The retry is for the model answering with nothing; a provider that
      // cannot synthesize will not succeed on a second model request.
      if (line !== null)
        return speech.synthesize(line)
    }

    logger.info('on-air.line_missing', { guildId })

    return null
  }

  // The next line is written while the current song plays, so the only silence
  // between songs is the line itself, not the model thinking and the provider
  // synthesizing it.
  async function prepare(guildId: string, track: Track, view: QueueView): Promise<void> {
    if (disposed || !speech.available || !model)
      return

    if (preparing.has(guildId) || linesInFlight.has(guildId))
      return

    if (station.preparedFor(guildId, track.id))
      return

    const onAir = station.songOnAir(guildId)

    // A playlist is added before its first song goes on air; preparing then
    // would read the cadence before that song took its slot.
    if (onAir === null || onAir !== view.current?.id)
      return

    // Do not spend a model call and a synthesis on a song that stays silent.
    if (!shouldSpeak(station.nextSongIndex(guildId), track.fromRadio))
      return

    preparing.add(guildId)

    try {
      // The prompt talks about the song that will be on air, so the queue view
      // is shifted to make that song the current one.
      const nextView: QueueView = { ...view, current: track, upcoming: view.upcoming.slice(1) }
      const file = await generateLine(guildId, track, nextView)

      if (file === null)
        return

      // The track changed while the line was being written: it belongs to a
      // song that will not play, and a file left behind is a file nobody
      // deletes.
      if (disposed || station.songOnAir(guildId) !== onAir) {
        await remove(file)

        return
      }

      const previous = station.setPrepared(guildId, { songId: track.id, file })

      if (previous)
        await remove(previous.file)
    }
    catch (error) {
      logger.error('on-air.prepare_failed', error, { guildId })
    }
    finally {
      preparing.delete(guildId)
    }
  }

  function startPrepare(guildId: string, track: Track, view: QueueView): void {
    void prepare(guildId, track, view).catch(error => logger.error('on-air.prepare_failed', error, { guildId }))
  }

  function prepareNext(guildId: string, view: QueueView): void {
    // The old hook read the queue again in its finally block: a song removed
    // while the line was airing must not be the one prepared next.
    const live = liveView(guildId) ?? view
    const next = live.upcoming[0]

    if (next)
      startPrepare(guildId, next, live)
  }

  // Called before a song starts: the stream waits for this hook, so the line
  // lands in the gap like a radio host and never on top of the music.
  async function beforeStream(input: BeforeStreamInput): Promise<void> {
    if (disposed)
      return

    // The line belongs to the song on the now-playing card, not to the search
    // result the stream resolved behind it. No card means nothing to announce.
    const song = input.view.current

    if (!song)
      return

    const index = station.recordSong(input.guildId, song.id)

    if (!speech.available || model === null || linesInFlight.has(input.guildId) || input.view.paused)
      return

    const { clip, discarded } = station.takePrepared(input.guildId, song.id)

    if (discarded)
      await remove(discarded.file)

    if (!shouldSpeak(index, song.fromRadio)) {
      if (clip !== null)
        await remove(clip.file)

      prepareNext(input.guildId, input.view)

      return
    }

    linesInFlight.add(input.guildId)

    let file = clip?.file ?? null

    try {
      // A prepared line is the fast path; the first song of a session and the
      // autoplay songs, which cannot be prepared ahead, get one written here.
      file ??= await generateLine(input.guildId, song, input.view)

      if (file === null)
        return

      logger.info('on-air.on_air', { guildId: input.guildId, track: song.title })

      if (await music.audio.playClip(input.guildId, file))
        station.recordLine(input.guildId)
      else
        logger.debug('on-air.clip_skipped', { guildId: input.guildId, track: song.title })
    }
    catch (error) {
      logger.error('on-air.line_failed', error, { guildId: input.guildId })
    }
    finally {
      if (file !== null)
        await remove(file)

      linesInFlight.delete(input.guildId)

      prepareNext(input.guildId, input.view)
    }
  }

  return {
    beforeStream,
    trackQueued({ guildId, track, view }) {
      if (disposed || view.upcoming[0]?.id !== track.id)
        return

      startPrepare(guildId, track, view)
    },
    playlistQueued({ guildId, view }) {
      if (!disposed)
        prepareNext(guildId, view)
    },
    disconnected(guildId) {
      const clip = station.endSession(guildId)

      if (clip)
        void remove(clip.file)
    },
    reset(guildId) {
      const clip = station.reset(guildId)

      if (clip)
        void remove(clip.file)
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
