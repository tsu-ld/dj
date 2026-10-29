import type { Clock } from '../core/clock.ts'
import type { MusicEventMap } from '../ports/music.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { SettingsPort } from '../ports/settings.ts'
import { cooldown } from '../core/cooldown.ts'
import { ERROR_ANNOUNCE_MS } from '../limits.ts'
import { MESSAGES } from '../messages.ts'

const MAX_THROTTLED_GUILDS = 1_000

export function djAnnouncements(deps: {
  replies: RepliesPort
  settings: SettingsPort
  clock: Clock
}) {
  // A broken playlist fails one song at a time; announcing every failure would
  // flood the channel and spend one model request per song. The slot is taken
  // before the channel check, exactly like the event handler this replaces.
  const errorWindow = cooldown(ERROR_ANNOUNCE_MS, {
    maxEntries: MAX_THROTTLED_GUILDS,
    now: () => deps.clock.now(),
  })

  return {
    trackQueued(payload: MusicEventMap['trackQueued']): void {
      if (!payload.announce || !payload.textChannel)
        return

      void deps.replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.songAdded(payload.track.title),
      )
    },
    playlistQueued(payload: MusicEventMap['playlistQueued']): void {
      if (!payload.announce || !payload.textChannel)
        return

      void deps.replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.playlistAdded(payload.name, payload.count),
      )
    },
    playbackError(payload: MusicEventMap['playbackError']): void {
      if (!errorWindow.take(payload.guildId) || !payload.textChannel)
        return

      void deps.replies.announce(
        payload.textChannel,
        deps.settings.get(payload.guildId),
        MESSAGES.playbackError,
      )
    },
  }
}
