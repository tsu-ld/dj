import { INTENTS } from '#features/config/intents.js'
import { readConfigFile } from '#features/config/read-config-file.js'

export async function loadConfig() {
  const fileConfig = await readConfigFile()

  if (!fileConfig.DISCORD_TOKEN)
    throw new Error('Missing DISCORD_TOKEN in config.json')

  return { ...fileConfig, INTENTS }
}
