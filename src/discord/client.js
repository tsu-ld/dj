import { Client, Events, GatewayIntentBits } from 'discord.js'

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
]

export const client = new Client({
  intents: INTENTS,
  allowedMentions: { parse: [], repliedUser: false },
})

client.once(Events.ClientReady, (readyClient) => {
  console.info(`[Discord] Ready as ${readyClient.user.tag}`)
})

client.on(Events.Error, (error) => {
  console.error('[Discord] Client error:', error)
})

client.on(Events.Warn, (warning) => {
  console.warn('[Discord] Client warning:', warning)
})
