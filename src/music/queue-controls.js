import { clearPlaybackMessages } from './now-playing.js'
import { player } from './player.js'

export const MAX_QUEUE_SIZE = 200

export function isPositionInQueue(queue, position) {
  return position > 0 && position <= queue.songs.length
}

export function queueRoom(queue, max = MAX_QUEUE_SIZE) {
  const occupied = queue?.songs.length ?? 0

  return Math.max(max - occupied, 0)
}

export function capQueue(queue, max = MAX_QUEUE_SIZE) {
  if (queue.songs.length <= max)
    return 0

  const removed = queue.songs.length - max
  queue.songs.splice(max)

  return removed
}

export async function clearQueue(queue) {
  await queue.stop()
  await clearPlaybackMessages(queue.id)
  // Queue#stop() neither disconnects nor emits finish; leave voice explicitly
  player.voices.get(queue.id)?.leave()
}

export async function skipSong(queue) {
  // songs is briefly empty during the autoplay transition while distube fetches the related song
  if (!queue.songs.length)
    return

  if (queue.songs.length > 1 || queue.autoplay) {
    try {
      await queue.skip()
    }
    catch (error) {
      // With autoplay on, the last song's skip waits for a related song; when
      // none is found distube throws and the skip button would stay dead.
      if (error.errorCode === 'NO_RELATED' || error.errorCode === 'NO_UP_NEXT')
        await clearQueue(queue)
      else
        throw error
    }
  }
  else {
    await clearQueue(queue)
  }
}

export async function removeSongAt(queue, position) {
  if (position === 1) {
    await skipSong(queue)

    return
  }

  // distube's Queue.remove() deletes the whole queue; there is no single-song
  // removal API, so remove from the internal song list directly.
  queue.songs.splice(position - 1, 1)
}
