import type { Logger } from '../core/logger.ts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { errorMessage } from '../core/errors.ts'
import { isRecord, parseJson } from '../core/json.ts'

export interface JsonMapFile<T> {
  // a missing file is empty; a file that is not this map is quarantined
  read: () => Promise<Record<string, T>>
  // writes run one after another, each through a temporary file
  write: (value: unknown) => Promise<void>
  settled: () => Promise<void>
}

// A map whose values are objects. One bad entry drops only that key; a map
// where no value is an object is not this file and comes back null.
export function normalizeMap<T>(value: unknown, entry: (value: unknown) => T | null): Record<string, T> | null {
  if (!isRecord(value))
    return null

  const entries = Object.entries(value)

  if (entries.length > 0 && !entries.some(([, item]) => isRecord(item)))
    return null

  const map: Record<string, T> = {}

  for (const [key, item] of entries) {
    const normalized = entry(item)

    if (normalized !== null)
      map[key] = normalized
  }

  return map
}

// `name` prefixes the log events: `<name>.quarantined`, `<name>.quarantine_failed`.
export function jsonMapFile<T>(options: { path: string, name: string, logger: Logger, entry: (value: unknown) => T | null }): JsonMapFile<T> {
  const { path, name, logger } = options
  let writes: Promise<void> = Promise.resolve()

  async function read(): Promise<Record<string, T>> {
    let text: string

    try {
      text = await readFile(path, 'utf8')
    }
    catch (error) {
      if (isRecord(error) && error.code === 'ENOENT')
        return {}

      throw error
    }

    const parsed = normalizeMap(parseJson(text), options.entry)

    if (parsed)
      return parsed

    const backup = `${path}.corrupt-${Date.now()}`

    try {
      await rename(path, backup)
      logger.warn(`${name}.quarantined`, { path, backup })
    }
    catch (error) {
      logger.warn(`${name}.quarantine_failed`, { path, error: errorMessage(error) })
    }

    return {}
  }

  async function write(value: unknown): Promise<void> {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`

      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
      await rename(temporary, path)
    })

    return writes
  }

  return { read, write, settled: async () => writes }
}
