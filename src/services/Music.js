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
    const queue = this.distube.getQueue(guildId)
    if (queue)
      queue.stop()
  }

  _wireEvents() {
    const player = this.distube
    player.on('addSong', (_queue, song) => console.log(`queued: ${song.name}`))
    player.on('playSong', (queue, song) => {
      console.log(`playing: ${song.name}`)
      queue.textChannel?.send(`arranca este temón: "${song.name}"`)
    })
    player.on('finish', () => console.log('queue finished'))
    player.on('error', error => console.error(`distube error:`, error))
  }
}
