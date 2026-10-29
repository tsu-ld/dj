import type { Logger } from '../../core/logger.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { errorMessage } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { DEFAULT_SETTINGS } from '../../ports/settings.ts'

type StoredSettings = Record<string, GuildSettings>

// A guild entry only carries the fields that differ from the defaults. Missing
// fields mean defaults, never a corrupt file.
function normalizeSettings(value: unknown): GuildSettings | null {
  if (!isRecord(value))
    return null

  const { textChannelId, persona } = value

  if (textChannelId !== undefined && textChannelId !== null && typeof textChannelId !== 'string')
    return null

  if (persona !== undefined && persona !== null && typeof persona !== 'string')
    return null

  return {
    textChannelId: typeof textChannelId === 'string' ? textChannelId : null,
    persona: typeof persona === 'string' ? persona : null,
  }
}

// The file is a flat guild map. One bad entry drops only that guild; a file
// where no entry is an object is not a settings file and gets quarantined.
function normalizeMap(value: unknown): StoredSettings | null {
  if (!isRecord(value))
    return null

  const entries = Object.entries(value)

  if (entries.length > 0 && !entries.some(([, settings]) => isRecord(settings)))
    return null

  const guilds: StoredSettings = {}

  for (const [guildId, settings] of entries) {
    const normalized = normalizeSettings(settings)

    if (normalized)
      guilds[guildId] = normalized
  }

  return guilds
}

async function read(filePath: string, logger: Logger): Promise<StoredSettings> {
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  }
  catch (error) {
    if (isRecord(error) && error.code === 'ENOENT')
      return {}

    throw error
  }

  const parsed = normalizeMap(parseJson(text))

  if (parsed)
    return parsed

  const backup = `${filePath}.corrupt-${Date.now()}`

  try {
    await rename(filePath, backup)
    logger.warn('settings.quarantined', { path: filePath, backup })
  }
  catch (error) {
    logger.warn('settings.quarantine_failed', { path: filePath, error: errorMessage(error) })
  }

  return {}
}

export async function settingsStore(options: { path: string, logger: Logger }): Promise<SettingsPort> {
  const logger = options.logger
  let file = await read(options.path, logger)
  let writes: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(options.path), { recursive: true })
      const temporary = `${options.path}.tmp`

      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`)
      await rename(temporary, options.path)
    })

    return writes
  }

  return {
    get(guildId) {
      const settings = file[guildId]

      return settings ? { ...settings } : { ...DEFAULT_SETTINGS }
    },
    async update(guildId, patch) {
      const current = file[guildId] ?? DEFAULT_SETTINGS

      file = {
        ...file,
        [guildId]: { ...current, ...patch },
      }
      await persist()
    },
    async flush() {
      await writes
    },
  }
}
