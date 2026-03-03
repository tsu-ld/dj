import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'
import { DisTube } from 'distube'

export function createPlayer(client) {
  return new DisTube(client, {
    plugins: [
      new SpotifyPlugin(),
      new YouTubePlugin({
        ytdlOptions: {
          quality: 'lowestaudio',
          filter: 'audioonly',
          highWaterMark: 1024 * 1024 * 2, // 2MB buffer
        },
      }),
    ],
    leaveOnEmpty: true,
    leaveOnFinish: true,
    leaveOnStop: true,
    emitAddListWhenCreatingQueue: true,
    emitAddSongWhenCreatingQueue: false,
    ffmpeg: {
      args: {
        global: ['-hide_banner'],
        input: ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'],
        output: [
          '-ac', '2',
          '-ar', '48000',
          '-b:a', '64k',
          '-map', '0:a',
          '-vn',
        ],
      },
    },
  })
}
