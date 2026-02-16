import * as fs from 'node:fs'
import * as process from 'node:process'
import { GatewayIntentBits } from 'discord.js'

export function createConfig() {
  const token = process.env.DISCORD_TOKEN

  validateEnv(token)

  const intents = getIntents()

  let fileConfig = {}
  try {
    const rawData = fs.readFileSync('config.json', 'utf-8')
    fileConfig = JSON.parse(rawData)
  }
  catch (error) {
    console.warn('Could not read config.json, using defaults or failing depending on usage.', error)
  }

  return { token, intents, ...fileConfig }
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
