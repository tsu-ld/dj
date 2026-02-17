import { CONFIG } from '../config/index.js'
import { saveConfigValue } from '../config/save-config-value.js'

export async function configureTextChannel(message) {
  const channel = message.mentions.channels.first()

  if (!channel.isTextBased())
    return

  CONFIG.TEXT_CHANNEL_ID = channel.id
  await saveConfigValue('TEXT_CHANNEL_ID', channel.id)
  console.info(`[Config] Text channel set to: ${channel.name} (${channel.id})`)
  message.reply(CONFIG.MESSAGES.CONFIGURATION.textChannelConfigured(channel))
}
