import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ASSETS_DIR = resolve('assets')

export function findIntroFile() {
  if (!existsSync(ASSETS_DIR))
    return null

  const mp3 = readdirSync(ASSETS_DIR).find(f => f.endsWith('.mp3'))
  return mp3 ? resolve(ASSETS_DIR, mp3) : null
}
