import { Client, Events } from 'discord.js'

export class Discord {
  constructor(config) {
    this.config = config
    this.client = new Client({ intents: config.intents })
    this.client.once(Events.ClientReady, (client) => {
      console.log(`ready: ${client.user.tag}`)
    })
  }

  async login() {
    return this.client.login(this.config.token)
  }

  onMessage(handler) {
    this.client.on(Events.MessageCreate, (message) => {
      if (message.author?.bot)
        return
      if (message.channelId !== this.config.textChannelId)
        return
      console.log('message: allowed channel event received')
      handler(message)
    })
  }

  getUserVoiceChannel(message) {
    return message.member?.voice?.channel ?? null
  }

  onBotKicked(fn) {
    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      const botId = this.client.user?.id
      if (!botId)
        return
      const leftChannel = oldState.channelId && !newState.channelId
      const isBot = oldState.member?.id === botId
      if (isBot && leftChannel)
        fn({ guildId: oldState.guild.id })
    })
  }
}
