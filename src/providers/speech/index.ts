import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { SpeechPort } from '../../ports/speech.ts'
import type { SpeechUsage } from './client.ts'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { speechClient, SpeechRequestError } from './client.ts'

interface UsageEntry extends SpeechUsage {
  readonly at: number
}

export function fitsQuota(usage: SpeechUsage, length: number): boolean {
  return usage.limit - usage.used >= length
}

// Returns the path to an mp3, or null when the voice is not configured, the
// quota is gone or the provider fails. A silent skip is the whole point: the
// radio is an extra, the music is not.
export function speechSynthesizer(deps: {
  config: AppConfig['speech']
  logger: Logger
  clock: Clock
}): SpeechPort {
  const { config, logger, clock } = deps

  if (!config.enabled)
    return { available: false, synthesize: async () => null, dispose: async () => {} }

  const { apiKey, voiceId, model, timeoutMs, maxChars, quotaCacheMs } = config
  const client = speechClient({ apiKey, voiceId, model, timeoutMs })
  const audioDir = join(tmpdir(), 'dj-audio')
  const files = new Set<string>()
  let available = true
  let usage: UsageEntry | null = null

  function markQuotaFull(): void {
    const limit = usage?.limit ?? 0

    usage = { used: limit, limit, at: clock.now() }
  }

  // Reading the quota is best effort: a failed check must not take the music
  // down, only a confirmed shortage skips the line.
  async function hasCharacters(length: number): Promise<boolean> {
    if (usage && clock.now() - usage.at < quotaCacheMs)
      return fitsQuota(usage, length)

    try {
      const fresh = await client.fetchUsage()

      usage = { ...fresh, at: clock.now() }

      return fitsQuota(usage, length)
    }
    catch (error) {
      logger.error('speech.quota_unreadable', error)

      return true
    }
  }

  async function synthesize(text: string): Promise<string | null> {
    if (!available || !text || text.length > maxChars)
      return null

    if (!(await hasCharacters(text.length))) {
      logger.info('speech.quota_exhausted', { length: text.length })

      return null
    }

    try {
      const audio = await client.synthesize(text)

      await mkdir(audioDir, { recursive: true })

      const file = join(audioDir, `tts-${clock.now()}-${Math.random().toString(36).slice(2)}.mp3`)

      await writeFile(file, audio)
      files.add(file)

      if (usage)
        usage = { ...usage, used: usage.used + text.length }

      return file
    }
    catch (error) {
      // A rejected key will keep rejecting until the process restarts with a
      // new one: stop paying a model call and a log line for every song. An
      // exhausted quota answers 401 too, so only the auth codes latch.
      if (error instanceof SpeechRequestError && error.failure === 'fatal') {
        available = false
        logger.error('speech.credentials_rejected', error)
      }
      else {
        // A quota rejection that slipped past the cache means the real count
        // is higher than the estimate: skip locally until the cache expires.
        if (error instanceof SpeechRequestError && error.failure === 'quota')
          markQuotaFull()

        logger.error('speech.synthesis_failed', error)
      }

      return null
    }
  }

  async function dispose(): Promise<void> {
    available = false

    const paths = [...files]

    files.clear()

    await Promise.all(paths.map(async path => rm(path, { force: true }).catch(() => {})))
  }

  return {
    get available() {
      return available
    },
    synthesize,
    release(path) {
      files.delete(path)
    },
    dispose,
  }
}
