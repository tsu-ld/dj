import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { elevenLabsConfigured, fetchUsage, synthesize } from '../providers/elevenlabs.js'

const AUDIO_DIR = join(tmpdir(), 'dj-audio')
const USAGE_CACHE_MS = 5 * 60_000

// Callers clamp the line already; this is the last stop before spending credits.
const SPEECH_MAX_CHARS = 300

let usage = null
let providerBroken = false

export function speechConfigured() {
  return !providerBroken && elevenLabsConfigured()
}

// A 401 is not always a bad key: ElevenLabs also answers 401 when the quota is
// gone. Only the codes that mean "this key will never work" turn the radio off
// for the rest of the process; anything else is retried on the next song.
const AUTH_FAILURES = new Set(['invalid_api_key', 'authentication_error'])

export function isAuthFailure(error) {
  const { code, status } = error?.detail ?? {}

  return error?.status === 403 || AUTH_FAILURES.has(code) || AUTH_FAILURES.has(status)
}

export function fitsQuota({ used, limit }, length) {
  return limit - used >= length
}

// Reading the quota is best effort: a failed check must not take the music down,
// only a confirmed shortage skips the line.
async function hasCharacters(length) {
  if (usage && Date.now() - usage.at < USAGE_CACHE_MS)
    return fitsQuota(usage, length)

  try {
    const { used, limit } = await fetchUsage()
    usage = { used, limit, at: Date.now() }

    return fitsQuota(usage, length)
  }
  catch (error) {
    console.error('[Voice] Could not read the character quota:', error)

    return true
  }
}

// Returns the path to an mp3, or null when the voice is not configured, the
// quota is gone or the provider fails. A silent skip is the whole point: the
// radio is an extra, the music is not.
export async function renderSpeech(text) {
  if (!speechConfigured() || !text || text.length > SPEECH_MAX_CHARS)
    return null

  if (!(await hasCharacters(text.length))) {
    console.info('[Voice] Out of characters for this period, skipping the line')

    return null
  }

  try {
    const audio = await synthesize(text)

    await mkdir(AUDIO_DIR, { recursive: true })

    const file = join(AUDIO_DIR, `tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`)

    await writeFile(file, audio)
    usage = usage && { ...usage, used: usage.used + text.length }

    return file
  }
  catch (error) {
    // A rejected key will keep rejecting until the process restarts with a new
    // one: stop paying an LLM call and a log line for every song. An exhausted
    // quota answers 401 too, so only the auth codes latch.
    if (isAuthFailure(error)) {
      providerBroken = true
      console.error('[Voice] ElevenLabs rejected the credentials; voice lines are off until restart:', error)
    }
    else {
      // A quota rejection that slipped past the cache means the real count is
      // higher than the estimate: skip locally until the cache expires.
      if (error.status === 401 || error.status === 402) {
        const limit = usage?.limit ?? 0

        usage = { used: limit, limit, at: Date.now() }
      }

      console.error('[Voice] Could not synthesize the line:', error)
    }

    return null
  }
}
