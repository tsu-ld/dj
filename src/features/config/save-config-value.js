import { readFile, writeFile } from 'node:fs/promises'

const CONFIG_PATH = 'config.json'

export async function saveConfigValue(key, value) {
  const current = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'))
  current[key] = value
  await writeFile(CONFIG_PATH, `${JSON.stringify(current, null, 2)}\n`)
}
