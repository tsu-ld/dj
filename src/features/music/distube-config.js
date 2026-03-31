import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'

export const DISTUBE_OPTIONS = {
  plugins: [
    new SpotifyPlugin(),
    new YouTubePlugin(),
  ],
  emitAddListWhenCreatingQueue: false,
  emitAddSongWhenCreatingQueue: false,
  emitNewSongOnly: true,
  savePreviousSongs: false,
  ffmpeg: {
    args: {
      global: {
        loglevel: 'error',
      },
      output: {
        acodec: 'libopus',
      },
    },
  },
}
