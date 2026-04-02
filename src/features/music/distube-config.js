import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'

export const DISTUBE_OPTIONS = {
  plugins: [
    new SpotifyPlugin(),
    new YouTubePlugin(),
  ],
  emitAddListWhenCreatingQueue: true,
  emitAddSongWhenCreatingQueue: false,
  ffmpeg: {
    args: {
      global: { hide_banner: true },
      input: {
        reconnect: 1,
        reconnect_streamed: 1,
        reconnect_delay_max: 5,
      },
      output: {
        'ac': 2,
        'ar': 48000,
        'b:a': '64k',
        'map': '0:a',
        'vn': true,
      },
    },
  },
}
