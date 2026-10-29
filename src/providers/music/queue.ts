import type { MusicEventMap, QueueView, Track } from '../../ports/music.ts'
import type { MutableTrackQueue, QueueState, SkippableQueue, StoppableQueue, TrackQueue } from './types.ts'
import { isRecord } from '../../core/json.ts'
import { isPositionInQueue as atPosition, MAX_QUEUE_SIZE, queueRoom as roomFor } from '../../limits.ts'

export function errorCodeOf(error: unknown): string | null {
  if (!isRecord(error))
    return null

  const code = error.errorCode ?? error.code

  return typeof code === 'string' ? code : null
}

export function isPositionInQueue(queue: TrackQueue, position: number): boolean {
  return atPosition(queue.songs.length, position)
}

export function queueRoom(queue: TrackQueue | null | undefined, max = MAX_QUEUE_SIZE): number {
  return roomFor(queue?.songs.length ?? 0, max)
}

export function capQueue(queue: MutableTrackQueue, max = MAX_QUEUE_SIZE): number {
  if (queue.songs.length <= max)
    return 0

  const removed = queue.songs.length - max

  queue.songs.splice(max)

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

// Autoplay additions arrive after the request that started them: they are radio
// songs and nothing asked for them in the channel.
export function announcesAdd(capture: { readonly announce: boolean } | undefined, track: Track): boolean {
  return capture?.announce === true && !track.fromRadio
}

export async function skipSong(queue: SkippableQueue, clear: () => Promise<void>): Promise<void> {
  // songs is briefly empty during the autoplay transition while the SDK fetches
  // the related song
  if (!queue.songs.length)
    return

  if (queue.songs.length > 1 || queue.autoplay) {
    try {
      await queue.skip()
    }
    catch (error) {
      // With autoplay on, the last song's skip waits for a related song; when
      // none is found it throws and the skip button would stay dead.
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

  // Queue.remove() deletes the whole queue; there is no single-song removal API,
  // so remove from the internal song list directly.
  queue.songs.splice(position - 1, 1)
}

// An explicit stop neither disconnects nor emits finish: leave voice here, and
// let one event cover the message cleanup and the station reset.
export async function clearStation(
  queue: StoppableQueue,
  leave: () => void,
  onCleared: (payload: MusicEventMap['queueCleared']) => void,
  resetStation: boolean,
): Promise<void> {
  await queue.stop()
  leave()
  onCleared({ guildId: queue.id, resetStation })
}

// The SDK shifts the failed song before emitting ERROR and then stops the queue
// without FINISH, which leaves the voice connection open. Compare against the
// live queue so a replacement queue does not get its connection closed.
export function shouldCleanupAfterError(queue: TrackQueue, liveQueue: TrackQueue | undefined): boolean {
  return queue.songs.length === 0 && liveQueue === queue
}

// A channel the bot is alone in is a dead session: the cards go away and the
// voice connection follows. A different channel or a non-empty one is not ours.
export function leavesEmptyChannel(voiceChannelId: string | null, oldChannelId: string | null, empty: boolean): boolean {
  return voiceChannelId !== null && voiceChannelId === oldChannelId && empty
}
