import { SoundCloudPlugin } from '@distube/soundcloud'
import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'

export const DISTUBE_OPTIONS = {
  plugins: [new SoundCloudPlugin(), new SpotifyPlugin(), new YouTubePlugin()],
  emitAddListWhenCreatingQueue: true,
  emitAddSongWhenCreatingQueue: false,
  savePreviousSongs: true,
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
        'b:a': '48k',
        'map': '0:a',
      },
    },
  },
}
