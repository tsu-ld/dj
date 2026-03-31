import { CONFIG } from '../../config/app-config.js'

export function onAddList(queue, playlist) {
  console.info(`[Music] Playlist added to queue: ${playlist.name} (${playlist.songs.length} songs)`)
  queue.textChannel?.send(CONFIG.MESSAGES.MUSIC.playlistAdded(playlist.name, playlist.songs.length))
}
