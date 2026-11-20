import type { QueueView, Track } from '../../ports/music.ts'
import type { MutableTrackQueue, QueueState, SkippableQueue, TrackQueue } from './types.ts'
import { isRecord } from '../../core/json.ts'
import { MAX_QUEUE_SIZE } from '../../limits.ts'

export function errorCodeOf(error: unknown): string | null {
  if (!isRecord(error))
    return null

  const code = error.errorCode ?? error.code

  return typeof code === 'string' ? code : null
}

export function capQueue(queue: MutableTrackQueue): number {
  if (queue.songs.length <= MAX_QUEUE_SIZE)
    return 0

  const removed = queue.songs.length - MAX_QUEUE_SIZE

  queue.songs.splice(MAX_QUEUE_SIZE)

  return removed
}

export function queueView<TSong>(
  queue: QueueState & { readonly songs: readonly TSong[] },
  trackOf: (song: TSong) => Track,
): QueueView {
  const [current, ...upcoming] = queue.songs

  return {
    current: current === undefined ? null : trackOf(current),
    upcoming: upcoming.map(song => trackOf(song)),
    paused: queue.paused,
    radio: queue.autoplay,
    size: queue.songs.length,
  }
}

export async function skipSong(queue: SkippableQueue, clear: () => Promise<void>): Promise<void> {
  // the SDK empties songs while autoplay fetches the related song
  if (!queue.songs.length)
    return

  if (queue.songs.length > 1 || queue.autoplay) {
    try {
      await queue.skip()
    }
    catch (error) {
      // with autoplay on, the SDK's skip of the last song throws when no related song is found
      const code = errorCodeOf(error)

      if (code === 'NO_RELATED' || code === 'NO_UP_NEXT')
        await clear()
      else
        throw error
    }
  }
  else {
    await clear()
  }
}

export async function removeSongAt(queue: MutableTrackQueue, position: number, skip: () => Promise<void>): Promise<void> {
  if (position === 1) {
    await skip()

    return
  }

  // the SDK's Queue.remove() deletes the whole queue and has no single-song removal
  queue.songs.splice(position - 1, 1)
}

// The SDK shifts the failed song before emitting ERROR and then stops the queue
// without FINISH, which leaves the voice connection open.
export function shouldCleanupAfterError(queue: TrackQueue, liveQueue: TrackQueue | undefined): boolean {
  return queue.songs.length === 0 && liveQueue === queue
}

export function leavesEmptyChannel(voiceChannelId: string | null, oldChannelId: string | null, empty: boolean): boolean {
  return voiceChannelId !== null && voiceChannelId === oldChannelId && empty
}

// The SDK resolves a Spotify song's stream through a separate YouTube song, not the queued one.
export function currentForStream<TSong extends { stream: { playFromSource?: boolean } }>(
  song: TSong,
  queue: { readonly songs: readonly TSong[] } | null,
): TSong | null {
  const current = queue?.songs[0]

  if (!current)
    return null

  if (current !== song && current.stream.playFromSource !== false)
    return null

  return current
}
