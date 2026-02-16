import { Client, Events } from 'discord.js'
import MESSAGES from '../utils/messages.js'
import { saveToConfig } from '../utils/save-config.js'

export class Discord {
  constructor(config) {
    this.config = config
    this.client = new Client({ intents: config.intents })
    this.client.once(Events.ClientReady, (client) => {
      console.warn(`ready: ${client.user.tag}`)
    })
  }

  async login() {
    return this.client.login(this.config.token)
  }

  onMessage(handler) {
    this.client.on(Events.MessageCreate, (message) => {
      if (this.shouldIgnore(message))
        return

      if (this.isConfigurationCommand(message))
        return this.configureTextChannel(message)

      if (this.isMessageFromAllowedChannel(message))
        handler(message)
    })
  }

  shouldIgnore(message) {
    return message.author?.bot
  }

  isConfigurationCommand(message) {
    return message.mentions.has(this.client.user) && message.mentions.channels.size > 0
  }

  configureTextChannel(message) {
    const channel = message.mentions.channels.first()
    if (channel.isTextBased()) {
      this.config.textChannelId = channel.id
      saveToConfig('textChannelId', channel.id)
      console.warn(`Configured text channel to: ${channel.name} (${channel.id})`)
      message.reply(MESSAGES.CONFIGURATION.textChannelConfigured(channel))
    }
  }

  isMessageFromAllowedChannel(message) {
    return message.channelId === this.config.textChannelId
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
