import { CONFIG } from '#features/config/index.js'
import { client } from '#client'

export async function login() {
  return client.login(CONFIG.DISCORD_TOKEN)
}
