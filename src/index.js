import {CONFIG} from './features/config/index.js'

import { createClient } from './features/discord/create-client.js'
import { login as loginToDiscord } from './features/discord/login.js'

import { createMessageHandler } from './features/handlers/create-message-handler.js'
import { setupMessageListener } from './features/handlers/setup-message-listener.js'
import { createPlayer } from './features/music/create-player.js'
import { setupMusicEvents } from './features/music/events/setup-music-events.js'

async function main() {
  const client = createClient()
  const player = createPlayer(client)

  setupMusicEvents(player)

  const handleMessage = createMessageHandler(player)
  setupMessageListener(client, handleMessage)

  await loginToDiscord(client, CONFIG.DISCORD_TOKEN)
}

main().catch(error => console.error('[System] Fatal error during startup:', error))
