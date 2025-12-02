import { SpotifyPlugin } from '@distube/spotify'
import { YouTubePlugin } from '@distube/youtube'
import { DisTube } from 'distube'
import MESSAGES from '../utils/messages.js'

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
    this.distube
      .on('addSong', this.onAddSong.bind(this))
      .on('playSong', this.onPlaySong.bind(this))
      .on('finish', this.onFinish.bind(this))
      .on('error', this.onError.bind(this))
  }

  onAddSong(_queue, song) {
    console.warn(`queued: ${song.name}`)
  }

  onPlaySong(queue, song) {
    console.warn(`playing: ${song.name}`)
    queue.textChannel?.send(MESSAGES.MUSIC.nowPlaying(song.name))
  }

  onFinish() {
    console.warn('queue finished')
  }

  onError(error) {
    console.error(`distube error:`, error)
  }
}
