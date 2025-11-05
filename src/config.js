import { GatewayIntentBits } from 'discord.js'

export function createConfig() {
  const token = process.env.DISCORD_TOKEN
  const textChannelId = process.env.TEXT_CHANNEL_ID

  if (!token || !textChannelId)
    throw new Error('Missing env: DISCORD_TOKEN and/or TEXT_CHANNEL_ID')

  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]

  return { token, textChannelId, intents }
}
