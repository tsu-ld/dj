import type { Clock } from '../core/clock.ts'
import type { MusicEventMap } from '../ports/music.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { SettingsPort } from '../ports/settings.ts'
import { cooldown } from '../core/cooldown.ts'
import { ERROR_ANNOUNCE_MS } from '../limits.ts'
import { MESSAGES } from '../messages.ts'

export function djAnnouncements(deps: {
  replies: RepliesPort
  settings: SettingsPort
  clock: Clock
}) {
  const errorWindow = cooldown(ERROR_ANNOUNCE_MS, { now: () => deps.clock.now() })

  return {
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
