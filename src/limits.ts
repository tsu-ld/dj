export const MAX_QUEUE_SIZE = 200
export const MAX_SONGS_PER_REQUEST = 10
export const MAX_PLAYLIST_SONGS = 50
export const MAX_PERSONA_LENGTH = 500
export const QUEUE_PAGE_SIZE = 10
export const UPCOMING_PREVIEW = 5
export const NOW_PLAYING_REPOST_MS = 2_000
export const ERROR_ANNOUNCE_MS = 30_000
export const HISTORY_MAX_MESSAGES = 16
export const HISTORY_IDLE_MS = 600_000
export const SPEECH_MAX_CHARS = 300
export const RADIO_SHORT_CHARS = 95
export const RADIO_LONG_CHARS = 200
export const RADIO_LONG_EVERY = 5
export const RADIO_SILENT_EVERY = 3
export const RADIO_SPEAK_EVERY = 3
export const PREPARED_CLIP_TTL_MS = 20 * 60_000

// The queue cap and the one-based position check are the same rule for every
// caller: the command layer reserves room before playing, the engine enforces
// it after adding, and the remove command validates the position.
export function queueRoom(occupied: number, max = MAX_QUEUE_SIZE): number {
  return Math.max(max - occupied, 0)
}

export function isPositionInQueue(size: number, position: number): boolean {
  return position > 0 && position <= size
}
