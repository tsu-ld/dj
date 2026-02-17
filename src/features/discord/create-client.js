import { Client, Events } from 'discord.js'
import { INTENTS } from '../config/intents.js'

export function createClient() {
  const client = new Client({ intents: INTENTS })

  client.once(Events.ClientReady, (c) => {
    console.info(`[Discord] Ready as ${c.user.tag}`)
  })

  return client
}
