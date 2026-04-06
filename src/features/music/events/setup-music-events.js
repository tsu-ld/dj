import { player } from '#player'
import { onAddList } from '#features/music/events/on-add-list.js'
import { onAddSong } from '#features/music/events/on-add-song.js'
import { onError } from '#features/music/events/on-error.js'
import { onFinish } from '#features/music/events/on-finish.js'
import { onPlaySong } from '#features/music/events/on-play-song.js'

export function setupMusicEvents() {
  player
    .on('addSong', onAddSong)
    .on('addList', onAddList)
    .on('playSong', onPlaySong)
    .on('finish', onFinish)
    .on('error', onError)
}
