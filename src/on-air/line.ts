import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { ListenerProfile, ListenersPort } from '../ports/listeners.ts'
import type { QueueView, Track } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { SongFacts } from '../ports/song-facts.ts'
import type { Angle } from './angle.ts'
import type { StationRun } from './station.ts'
import { ProviderError } from '../core/errors.ts'
import { pickAngle } from './angle.ts'
import { buildOnAirPrompt, lineLimit, lineRequest, sanitizeLine } from './script.ts'

const LINE_TIMEOUT_MS = 8_000
// The model reasons before answering and the reasoning counts against this cap:
// with 160 it produced only reasoning, and with 600 it sometimes burned the
// whole budget thinking and returned no line at all.
const LINE_MAX_OUTPUT_TOKENS = 1_200
// A rejected key or an empty balance does not fix itself between two songs;
// retrying on every song only floods the log (a 401 once logged 57 failed
// lines over three days).
const MODEL_PAUSE_MS = 10 * 60_000
const MAX_NEXT = 3

export interface LineContext {
  readonly guildId: string
  readonly track: Track
  // the queue with `track` as the current song
  readonly view: QueueView
  readonly first: boolean
  readonly long: boolean
  readonly run: StationRun
  readonly facts: SongFacts | null
  readonly listener: ListenerProfile | null
  readonly lastAngle: Angle | null
}

export interface WrittenLine {
  readonly text: string
  readonly angle: Angle
}

export interface LineWriter {
  // a model is configured and not paused after a fatal failure
  ready: () => boolean
  write: (context: LineContext) => Promise<WrittenLine | null>
}

// The facts a line is written from: the song and who asked for it, what comes
// next, whether the radio carries on after it, and how the last song ended.
// The same video can be queued by two members, so the id alone does not say
// who asked. A clip whose key differs from the live one says something false.
export function clipKey(track: Track, next: Pick<QueueView, 'upcoming' | 'radio'>, run: StationRun): string {
  return JSON.stringify([track.id, track.requesterId, next.upcoming.slice(0, MAX_NEXT).map(song => song.id), next.radio, run.lastId, run.last?.skippedBy ?? null])
}

// Only a rejected key or an empty balance outlasts the next song. Any other
// 4xx, such as a content filter tripped by one title, skips that line alone.
function pausesTheModel(error: unknown): error is ProviderError {
  return error instanceof ProviderError && (error.failure === 'quota' || error.status === 401 || error.status === 403)
}

// A member the store has never seen is on their first request, not unknown.
export function requesterOf(listeners: ListenersPort, guildId: string, track: Track): ListenerProfile | null {
  if (track.fromRadio || track.requesterId === null)
    return null

  return listeners.profile(guildId, track.requesterId) ?? {
    name: track.requestedBy ?? '',
    requests: 0,
    topSong: null,
    topArtists: [],
  }
}

export function lineWriter(deps: {
  model: ConversationPort | null
  settings: SettingsPort
  logger: Logger
  clock: Clock
}): LineWriter {
  const { model, settings, logger, clock } = deps
  let pausedUntil = 0

  function ready(): boolean {
    return model !== null && clock.now() >= pausedUntil
  }

  function pause(guildId: string, error: ProviderError): void {
    // Concurrent lines can fail together; the pause is logged once.
    if (clock.now() >= pausedUntil)
      logger.warn('on-air.model_paused', { guildId, failure: error.failure, status: error.status, pauseMs: MODEL_PAUSE_MS })

    pausedUntil = clock.now() + MODEL_PAUSE_MS
  }

  // The model occasionally spends the whole budget on reasoning and answers
  // with nothing; one retry is cheaper than a silent transition.
  async function write(context: LineContext): Promise<WrittenLine | null> {
    if (model === null || !ready())
      return null

    const { guildId, track, view, first, run, facts, listener } = context
    // A welcome is short whatever the cadence says.
    const long = context.long && !first
    const now = clock.now()
    // A welcome opens a new session: the songs of the last one are not
    // back-announced.
    const last = first ? null : run.last
    const angle = pickAngle({ long, first, track, facts, listener, lastAngle: context.lastAngle, now })
    const instructions = buildOnAirPrompt({
      settings: settings.get(guildId),
      track,
      long,
      last,
      earlier: first ? [] : run.earlier,
      upcoming: view.upcoming,
      radio: view.radio,
      facts,
      listener,
      angle,
      now,
    })

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reply = await model.complete({
          instructions,
          messages: [{ role: 'user', content: lineRequest({ long, angle }) }],
          timeoutMs: LINE_TIMEOUT_MS,
          maxOutputTokens: LINE_MAX_OUTPUT_TOKENS,
          // Radio lines are short and live; thinking only adds seconds of silence.
          reasoning: 'none',
          sessionId: `voice:${guildId}`,
        })
        const text = sanitizeLine(reply.text, lineLimit(long))

        if (text !== null)
          return { text, angle }
      }
      catch (error) {
        if (pausesTheModel(error)) {
          pause(guildId, error)

          return null
        }

        throw error
      }
    }

    logger.info('on-air.line_missing', { guildId })

    return null
  }

  return { ready, write }
}
