import type { Logger } from '../../core/logger.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { errorMessage } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { DEFAULT_SETTINGS } from '../../ports/settings.ts'

interface StoredFile {
  version: 1
  guilds: Record<string, GuildSettings>
}

// A release before the settings file was versioned wrote only the fields a
// guild had changed. Missing fields mean defaults, never a corrupt file.
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

function normalizeMap(values: Record<string, unknown>): Record<string, GuildSettings> {
  const guilds: Record<string, GuildSettings> = {}

  for (const [guildId, value] of Object.entries(values)) {
    const settings = normalizeSettings(value)

    if (settings)
      guilds[guildId] = settings
  }

  return guilds
}

// The first release wrote a bare guild map. Reading it costs ten lines and
// saves every server from reconfiguring its channel and persona.
function migrate(raw: unknown): StoredFile | null {
  if (!isRecord(raw))
    return null

  if (raw.version === 1)
    return isRecord(raw.guilds) ? { version: 1, guilds: normalizeMap(raw.guilds) } : null

  if (raw.version !== undefined)
    return null

  // A bare guild map. One bad entry drops only that guild; a file where no
  // entry is even an object is not a settings file and is quarantined.
  const entries = Object.entries(raw)

  if (entries.length > 0 && !entries.some(([, value]) => isRecord(value)))
    return null

  return { version: 1, guilds: normalizeMap(raw) }
}

async function read(filePath: string, logger: Logger): Promise<StoredFile> {
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  }
  catch (error) {
    if (isRecord(error) && error.code === 'ENOENT')
      return { version: 1, guilds: {} }

    throw error
  }

  const parsed = migrate(parseJson(text))

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

  return { version: 1, guilds: {} }
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
      const settings = file.guilds[guildId]

      return settings ? { ...settings } : { ...DEFAULT_SETTINGS }
    },
    async update(guildId, patch) {
      const current = file.guilds[guildId] ?? DEFAULT_SETTINGS

      file = {
        version: 1,
        guilds: {
          ...file.guilds,
          [guildId]: { ...current, ...patch },
        },
      }
      await persist()
    },
    async flush() {
      await writes
    },
  }
}
