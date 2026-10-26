import process from 'node:process'
import { SpotifyPlugin } from '@distube/spotify'
import { DisTube } from 'distube'
import { client } from '../discord/client.js'
import { YtDlpPlugin } from './yt-dlp-plugin.js'

const spotifyClientId = process.env.SPOTIFY_CLIENT_ID
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET

const spotifyPlugin = spotifyClientId && spotifyClientSecret
  ? new SpotifyPlugin({ api: { clientId: spotifyClientId, clientSecret: spotifyClientSecret } })
  : new SpotifyPlugin()

export const ytDlpPlugin = new YtDlpPlugin()

export const player = new DisTube(client, {
  plugins: [spotifyPlugin, ytDlpPlugin],
  emitAddListWhenCreatingQueue: true,
  emitAddSongWhenCreatingQueue: false,
  savePreviousSongs: false,
  ffmpeg: {
    args: {
      // the downloaded mp4 carries video too; extract only the audio stream
      output: { map: '0:a' },
    },
  },
})
