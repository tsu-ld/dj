import { player } from '#player'
import { onAddList } from './on-add-list.js'
import { onAddSong } from './on-add-song.js'
import { onError } from './on-error.js'
import { onFinish } from './on-finish.js'
import { onPlaySong } from './on-play-song.js'

export function setupMusicEvents() {
  player
    .on('addSong', onAddSong)
    .on('addList', onAddList)
    .on('playSong', onPlaySong)
    .on('finish', onFinish)
    .on('error', onError)
}
