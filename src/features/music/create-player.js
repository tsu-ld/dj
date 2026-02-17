import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'
import { DisTube } from 'distube'

export function createPlayer(client) {
  return new DisTube(client, {
    plugins: [
      new SpotifyPlugin(),
      new YouTubePlugin(),
    ],
    emitAddListWhenCreatingQueue: true,
    emitAddSongWhenCreatingQueue: false,
  })
}
