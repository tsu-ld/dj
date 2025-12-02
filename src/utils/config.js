import * as process from 'node:process'
import { GatewayIntentBits } from 'discord.js'

export function createConfig() {
  const token = process.env.DISCORD_TOKEN

  validateEnv(token)

  const intents = getIntents()

  return { token, intents }
}

function validateEnv(token) {
  if (!token)
    throw new Error('Missing env: DISCORD_TOKEN')
}

function getIntents() {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]
}
