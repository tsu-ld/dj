import type { GuildTextBasedChannel } from 'discord.js'
import type { Song } from 'distube'
import type { QueueView, Track } from '../../ports/music.ts'
import { isRecord } from '../../core/json.ts'
import { MAX_QUEUE_SIZE } from '../../limits.ts'

interface TrackQueue {
  readonly songs: ReadonlyArray<unknown>
}

interface MutableTrackQueue {
  songs: Array<unknown>
}

interface QueueState extends TrackQueue {
  readonly paused: boolean
  readonly autoplay: boolean
}

interface SkippableQueue extends TrackQueue {
  readonly autoplay: boolean
  skip: () => Promise<Song | void>
}

interface QueueAddress {
  readonly guildId: string
  readonly textChannel: GuildTextBasedChannel | null
}

export function addressOf(queue: {
  readonly id: string
  readonly textChannel?: GuildTextBasedChannel
}): QueueAddress {
  return { guildId: queue.id, textChannel: queue.textChannel ?? null }
}

export function errorCodeOf(error: unknown): string | null {
  if (!isRecord(error)) {
    return null
  }

  const code = error.errorCode ?? error.code

  return typeof code === 'string' ? code : null
}

export function capQueue(queue: MutableTrackQueue): number {
  if (queue.songs.length <= MAX_QUEUE_SIZE) {
    return 0
  }

  const removed = queue.songs.length - MAX_QUEUE_SIZE

  queue.songs.splice(MAX_QUEUE_SIZE)

  return removed
}

export function queueView<TSong>(
  queue: QueueState & { readonly songs: ReadonlyArray<TSong> },
  trackOf: (song: TSong) => Track,
): QueueView {
  const [current, ...upcoming] = queue.songs

  return {
    current: current === undefined ? null : trackOf(current),
    upcoming: upcoming.map((song) => trackOf(song)),
    paused: queue.paused,
    radio: queue.autoplay,
    size: queue.songs.length,
  }
}

export async function skipSong(queue: SkippableQueue, clear: () => Promise<void>): Promise<void> {
  // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/core/manager/QueueManager.ts#L73-L81): distube shifts the finished song before it awaits the related one, so songs is empty during the fetch; a skip then does nothing.
  if (queue.songs.length === 0) {
    return
  }

  if (queue.songs.length > 1 || queue.autoplay) {
    try {
      await queue.skip()
    } catch (error) {
      // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/struct/Queue.ts#L411): with autoplay on, skip() of the last song throws NO_RELATED (or NO_UP_NEXT) when no related song is found; the queue is cleared instead.
      const code = errorCodeOf(error)

      if (code === 'NO_RELATED' || code === 'NO_UP_NEXT') {
        await clear()
      } else {
        throw error
      }
    }
  } else {
    await clear()
  }
}

export async function removeSongAt(
  queue: MutableTrackQueue,
  position: number,
  skip: () => Promise<void>,
): Promise<void> {
  if (position === 1) {
    await skip()

    return
  }

  // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/struct/Queue.ts#L445): Queue.remove() deletes the whole queue and distube has no single-song removal, so the song is spliced out of songs.
  queue.songs.splice(position - 1, 1)
}

// WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/core/manager/QueueManager.ts#L116-L129): on a playback error distube shifts the failed song, stops the queue without FINISH, and stop() does not leave voice; the bot cleans up.
export function shouldCleanupAfterError(
  queue: TrackQueue,
  liveQueue: TrackQueue | undefined,
): boolean {
  return queue.songs.length === 0 && liveQueue === queue
}

export function leavesEmptyChannel(
  voiceChannelId: string | null,
  oldChannelId: string | null,
  empty: boolean,
): boolean {
  return voiceChannelId !== null && voiceChannelId === oldChannelId && empty
}

// WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/core/DisTubeHandler.ts#L114): distube plays a Spotify song through a second YouTube song it searches for (song.stream.song), not the queued one; the queued song is matched instead.
export function currentForStream<TSong extends { stream: { playFromSource?: boolean } }>(
  song: TSong,
  queue: { readonly songs: ReadonlyArray<TSong> } | null,
): TSong | null {
  const current = queue?.songs[0]

  if (!current) {
    return null
  }

  if (current !== song && current.stream.playFromSource !== false) {
    return null
  }

  return current
}
