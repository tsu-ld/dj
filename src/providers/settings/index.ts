import type { Logger } from '../../core/logger.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import { isRecord } from '../../core/json.ts'
import { DEFAULT_SETTINGS } from '../../ports/settings.ts'
import { jsonMapFile } from '../json-file.ts'

type StoredSettings = Record<string, GuildSettings>

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

export async function settingsStore(options: { path: string, logger: Logger }): Promise<SettingsPort> {
  const store = jsonMapFile({ path: options.path, name: 'settings', logger: options.logger, entry: normalizeSettings })
  let file: StoredSettings = await store.read()

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
      await store.write(file)
    },
    async flush() {
      await store.settled()
    },
  }
}
