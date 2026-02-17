import { Events } from 'discord.js'
import { CONFIG } from '../config/index.js'
import { configureTextChannel } from '../discord/configure-text-channel.js'
import { isConfigurationCommand } from '../discord/is-configuration-command.js'
import { shouldIgnoreMessage } from '../discord/should-ignore-message.js'

export function setupMessageListener(client, onMessage) {
  client.on(Events.MessageCreate, (message) => {
    if (shouldIgnoreMessage(message))
      return

    if (isConfigurationCommand(message, client.user))
      return configureTextChannel(message)

    if (message.channelId === CONFIG.TEXT_CHANNEL_ID)
      onMessage(message)
  })
}
