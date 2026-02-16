import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ASSETS_DIR = resolve('assets')

export function introFilePath(filename) {
  const absolute = resolve(ASSETS_DIR, filename)

  if (!existsSync(absolute))
    throw new Error(`Intro file not found: ${absolute}`)

  return absolute
}
