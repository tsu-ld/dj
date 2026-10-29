import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { MusicEventMap } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import { ttlMap } from '../core/ttl-map.ts'
import { ERROR_ANNOUNCE_MS } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { djReplies } from './replies.ts'

const MAX_THROTTLED_GUILDS = 1_000

export function djAnnouncements(deps: {
  model: ConversationPort | null
  settings: SettingsPort
  logger: Logger
  clock: Clock
}) {
  const replies = djReplies({ model: deps.model, logger: deps.logger })
  const lastErrorAt = ttlMap<string, number>({
    ttlMs: ERROR_ANNOUNCE_MS,
    max: MAX_THROTTLED_GUILDS,
    now: () => deps.clock.now(),
  })

  // A broken playlist fails one song at a time; announcing every failure would
  // flood the channel and spend one model request per song. The slot is taken
  // before the channel check, exactly like the event handler this replaces.
  function takeErrorSlot(guildId: string): boolean {
    if (lastErrorAt.get(guildId) !== undefined)
      return false

    lastErrorAt.set(guildId, deps.clock.now())

    return true
  }

  return {
    trackQueued(payload: MusicEventMap['trackQueued']): void {
      if (!payload.announce || !payload.textChannel)
        return

      void replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.songAdded(payload.track.title),
      )
    },
    playlistQueued(payload: MusicEventMap['playlistQueued']): void {
      if (!payload.announce || !payload.textChannel)
        return

      void replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.playlistAdded(payload.name, payload.count),
      )
    },
    playbackError(payload: MusicEventMap['playbackError']): void {
      if (!takeErrorSlot(payload.guildId) || !payload.textChannel)
        return

      void replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.playbackError,
      )
    },
  }
}
