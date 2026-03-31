import { client } from '#client'
import { CONFIG } from '#features/config/app-config.js'
import { Events } from 'discord.js'
import { configureTextChannel } from '../discord/configure-text-channel.js'
import { isConfigurationCommand } from '../discord/is-configuration-command.js'
import { shouldIgnoreMessage } from '../discord/should-ignore-message.js'
import { handleMessage } from './message-handler.js'

export function setupMessageListener() {
  client.on(Events.MessageCreate, (message) => {
    if (shouldIgnoreMessage(message))
      return

    if (isConfigurationCommand(message))
      return configureTextChannel(message)

    if (message.channelId === CONFIG.TEXT_CHANNEL_ID)
      handleMessage(message)
  })
}
