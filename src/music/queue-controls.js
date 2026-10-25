import { clearPlaybackMessages } from './now-playing.js'
import { player } from './player.js'

export function isPositionInQueue(queue, position) {
  return position > 0 && position <= queue.songs.length
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
    await queue.skip()
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
