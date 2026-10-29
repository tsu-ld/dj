import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const DEFAULT_SETTINGS = { textChannelId: null, persona: null }

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

function hasValidShape(settings) {
  return isPlainObject(settings) && Object.values(settings).every(isPlainObject)
}

async function quarantine(filePath, reason) {
  const backupPath = `${filePath}.corrupt-${Date.now()}`

  try {
    await rename(filePath, backupPath)
    console.warn(`[Settings] ${reason} in ${filePath}; moved it to ${backupPath} and started with an empty store`)
  }
  catch (error) {
    console.warn(`[Settings] ${reason} in ${filePath}, and could not move it aside (${error.message}); starting with an empty store`)
  }
}

async function readSettings(filePath) {
  let raw

  try {
    raw = await readFile(filePath, 'utf-8')
  }
  catch (error) {
    if (error.code === 'ENOENT')
      return {}

    throw error
  }

  let settings

  try {
    settings = JSON.parse(raw)
  }
  catch {
    await quarantine(filePath, 'Invalid JSON')

    return {}
  }

  if (!hasValidShape(settings)) {
    await quarantine(filePath, 'Unexpected settings shape')

    return {}
  }

  return settings
}

export async function loadSettingsStore(filePath) {
  let settings = await readSettings(filePath)
  let writeChain = Promise.resolve()

  function writeSettings() {
    writeChain = writeChain.catch(() => {}).then(async () => {
      await mkdir(dirname(filePath), { recursive: true })
      const tempPath = `${filePath}.tmp`
      await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`)
      await rename(tempPath, filePath)
    })

    return writeChain
  }

  return {
    get(guildId) {
      const guild = settings[guildId]

      return isPlainObject(guild) ? { ...guild } : { ...DEFAULT_SETTINGS }
    },
    async updateGuild(guildId, changes) {
      const current = isPlainObject(settings[guildId]) ? settings[guildId] : {}

      settings = {
        ...settings,
        [guildId]: { ...current, ...changes },
      }
      await writeSettings()
    },
  }
}
