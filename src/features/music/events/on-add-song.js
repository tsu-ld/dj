import { CONFIG } from '../../config/index.js'
 
export function onAddSong(queue, song) {
  const { songAdded } = CONFIG.MESSAGES.MUSIC

  console.info(`[Music] Song added to queue: ${song.name}`)
  queue.textChannel?.send(songAdded(song.name))
}
