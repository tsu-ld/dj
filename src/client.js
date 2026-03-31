import { INTENTS } from '#features/config/intents.js'
import { Client, Events } from 'discord.js'

export const client = new Client({ intents: INTENTS })

client.once(Events.ClientReady, (c) => {
  console.info(`[Discord] Ready as ${c.user.tag}`)
})
