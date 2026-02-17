import { onAddSong } from './on-add-song.js'
import { onError } from './on-error.js'
import { onFinish } from './on-finish.js'
import { createOnPlaySong } from './on-play-song.js'

export function setupMusicEvents(player) {
  player
    .on('addSong', onAddSong)
    .on('playSong', createOnPlaySong())
    .on('finish', onFinish)
    .on('error', onError)
}
