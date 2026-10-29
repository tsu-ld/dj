import type { AppConfig } from '../config.ts'
import type { Logger } from '../core/logger.ts'
import { Client, Events, GatewayIntentBits } from 'discord.js'

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
]

// Mentions are disabled by default for every message the bot sends: an
// untrusted song title must never ping a role or a person.
export function discordClient(config: AppConfig, logger: Logger): Client {
  const client = new Client({
    intents: INTENTS,
    allowedMentions: { parse: [], repliedUser: false },
  })

  client.token = config.discord.token

  client.once(Events.ClientReady, ready => logger.info('discord.ready', { user: ready.user.tag }))
  client.on(Events.Error, error => logger.error('discord.error', error))
  client.on(Events.Warn, warning => logger.warn('discord.warning', { warning }))

  return client
}
