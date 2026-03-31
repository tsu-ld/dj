import { client } from '#client'
import { CONFIG } from '#features/config/index.js'

export async function login() {
  return client.login(CONFIG.DISCORD_TOKEN)
}
