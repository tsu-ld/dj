import { client } from '#client'
import { CONFIG } from '../config/app-config.js'

export async function login() {
  return client.login(CONFIG.DISCORD_TOKEN)
}
