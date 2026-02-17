import { CONFIG } from '../../config/index.js'

export function createOnPlaySong() {
  const { nowPlaying } = CONFIG.MESSAGES.MUSIC

  return function onPlaySong(queue, song) {
    console.info(`[Music] Now playing: ${song.name}`)
    queue.textChannel?.send(nowPlaying(song.name))
  }
}
