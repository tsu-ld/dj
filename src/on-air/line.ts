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
import { buildOnAirPrompt, lineLimit, lineRequest, MAX_NEXT, sanitizeLine } from './script.ts'

const LINE_TIMEOUT_MS = 8_000
// The model's reasoning counts against this cap: 160 returned only reasoning
// and 600 sometimes no line.
const LINE_MAX_OUTPUT_TOKENS = 1_200
const MODEL_PAUSE_MS = 10 * 60_000

export interface LineContext {
  readonly guildId: string
  readonly track: Track
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
  ready: () => boolean
  write: (context: LineContext) => Promise<WrittenLine | null>
}

export function clipKey(track: Track, next: Pick<QueueView, 'upcoming' | 'radio'>, run: StationRun): string {
  return JSON.stringify([track.id, track.requesterId, next.upcoming.slice(0, MAX_NEXT).map(song => song.id), next.radio, run.lastId, run.last?.skippedBy ?? null])
}

function pausesTheModel(error: unknown): error is ProviderError {
  return error instanceof ProviderError && (error.failure === 'quota' || error.status === 401 || error.status === 403)
}

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
    if (clock.now() >= pausedUntil)
      logger.warn('on-air.model_paused', { guildId, failure: error.failure, status: error.status, pauseMs: MODEL_PAUSE_MS })

    pausedUntil = clock.now() + MODEL_PAUSE_MS
  }

  // The model sometimes spends the whole budget reasoning and answers with
  // nothing, so a line gets one retry.
  async function write(context: LineContext): Promise<WrittenLine | null> {
    if (model === null || !ready())
      return null

    const { guildId, track, view, first, run, facts, listener } = context
    const long = context.long && !first
    const now = clock.now()
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
