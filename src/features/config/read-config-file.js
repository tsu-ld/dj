import { readFile } from 'node:fs/promises'

const CONFIG_PATH = 'config.json'

export async function readConfigFile() {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')

    return JSON.parse(raw)
  }
  catch (error) {
    console.info('[Config] Warning: Could not read config.json, using defaults.', error.message)

    return {}
  }
}
