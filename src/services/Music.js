import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'
import { DisTube } from 'distube'

export class Music {
  constructor() {
    this.distube = null
  }

  attach(client) {
    this.distube = new DisTube(client, {
      plugins: [
        new SpotifyPlugin(),
        new YouTubePlugin(),
      ],
    })
    this._wireEvents()
  }

  async play(voiceChannel, query, message) {
    return this.distube.play(voiceChannel, query, {
      textChannel: message.channel,
      member: message.member,
    })
  }

  stopByGuildId(guildId) {
    const q = this.distube.getQueue(guildId)
    if (q)
      q.stop()
  }

  _wireEvents() {
    const d = this.distube
    d.on('addSong', (_queue, song) => console.log(`queued: ${song.name}`))
    d.on('playSong', (queue, song) => {
      console.log(`playing: ${song.name}`)
      queue.textChannel?.send(`ta sonando: ${song.name}`)
    })
    d.on('finish', () => console.log('queue finished'))
    d.on('error', e => console.error(`distube error: ${e?.message ?? e}`))
  }
}
