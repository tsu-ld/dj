import { CONFIG } from '#features/config/app-config.js'

export function onPlaySong(queue, song) {
  const { nowPlaying } = CONFIG.MESSAGES.MUSIC

  console.info(`[Music] Now playing: ${song.name}`)
  queue.textChannel?.send(nowPlaying(song.name))
}
