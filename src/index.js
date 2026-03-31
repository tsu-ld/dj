import '#player'
import { login as loginToDiscord } from '#features/discord/login.js'
import { setupMessageListener } from '#features/handlers/setup-message-listener.js'
import { setupMusicEvents } from '#features/music/events/setup-music-events.js'

async function main() {
  setupMusicEvents()
  setupMessageListener()

  await loginToDiscord()
}

main().catch(error => console.error('[System] Fatal error during startup:', error))
