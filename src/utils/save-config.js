import { readFileSync, writeFileSync } from 'node:fs'

const CONFIG_PATH = 'config.json'

export function saveToConfig(key, value) {
  const current = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  current[key] = value
  writeFileSync(CONFIG_PATH, `${JSON.stringify(current, null, 2)}\n`)
}
