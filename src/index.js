import { resolve } from 'node:path'
import process from 'node:process'
import { client } from './discord/client.js'
import { setupInteractionRouter } from './discord/route-interaction.js'
import { setupMessageRouter } from './discord/route-message.js'
import { loadSettingsStore } from './guild-settings/store.js'
import { setupLeaveWhenEmpty } from './music/leave-when-empty.js'
import { setupMusicEvents } from './music/queue-events.js'
import './music/player.js'

const SETTINGS_PATH = resolve(import.meta.dirname, '../data/guilds.json')

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown)
    return

  shuttingDown = true
  console.info(`[System] Received ${signal}, shutting down`)

  try {
    await client.destroy()
  }
  catch (error) {
    console.error('[System] Error while shutting down:', error)
  }

  process.exit(0)
}

async function main() {
  const token = process.env.DISCORD_TOKEN

  if (!token)
    throw new Error('Missing DISCORD_TOKEN. Set it in the environment.')

  const store = await loadSettingsStore(SETTINGS_PATH)

  setupMusicEvents(store)
  setupLeaveWhenEmpty()
  setupMessageRouter(store)
  setupInteractionRouter()

  await client.login(token)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

main().catch((error) => {
  console.error('[System] Fatal error during startup:', error)
  process.exitCode = 1
})
