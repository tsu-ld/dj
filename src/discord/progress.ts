import type { QueueView } from '../ports/music.ts'

// Discord rate-limits message edits; a card repainted every 15s stays far below
// it while still moving visibly.
export const PROGRESS_REPAINT_MS = 15_000

const UNKNOWN_MESSAGE = 10_008
// Discord caps edits to a message older than an hour (error 30046), and a card
// edited every few seconds would reach that cap
const EDITABLE_FOR_MS = 55 * 60_000

// Only a deleted card is gone; a timeout or a rate limit keeps it for the next try.
export function isDeletedMessage(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNKNOWN_MESSAGE
}

export function isPastEditWindow(message: { readonly createdTimestamp: number } | undefined, now: number): boolean {
  return message !== undefined && now - message.createdTimestamp > EDITABLE_FOR_MS
}

export interface ProgressTimers {
  // starts or stops the guild's repaint for the song this view shows
  sync: (guildId: string, view: QueueView) => void
  stop: (guildId: string) => void
  dispose: () => void
}

// One repaint timer per guild, only for a playing song with a known length; a
// tick that finds the player not playing skips its repaint.
export function progressTimers(deps: {
  playing: (guildId: string) => boolean
  repaint: (guildId: string) => void
}): ProgressTimers {
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  let disposed = false

  function stop(guildId: string): void {
    const timer = timers.get(guildId)

    if (timer) {
      clearInterval(timer)
      timers.delete(guildId)
    }
  }

  return {
    sync(guildId, view) {
      const track = view.current
      const ticking = !disposed && !view.paused
        && track !== null && !track.isLive && track.durationSeconds > 0

      if (!ticking) {
        stop(guildId)

        return
      }

      if (timers.has(guildId))
        return

      timers.set(guildId, setInterval(() => {
        if (deps.playing(guildId))
          deps.repaint(guildId)
      }, PROGRESS_REPAINT_MS))
    },
    stop,
    dispose() {
      disposed = true

      for (const timer of timers.values())
        clearInterval(timer)

      timers.clear()
    },
  }
}
