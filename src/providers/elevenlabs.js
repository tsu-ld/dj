import process from 'node:process'

const API_BASE = 'https://api.elevenlabs.io/v1'
const OUTPUT_FORMAT = 'mp3_44100_128'
const REQUEST_TIMEOUT_MS = 12_000
const MAX_ERROR_BODY = 300

const DEFAULT_MODEL = 'eleven_v4'
// Lower stability buys more emotional range; the voice is directed with audio
// tags in the text, so it does not need a fixed baseline performance.
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 }

export function elevenLabsConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID)
}

async function request(path, init = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY

  if (!apiKey)
    throw new Error('Missing ELEVENLABS_API_KEY.')

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'xi-api-key': apiKey, ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await response.text()
    const error = new Error(`ElevenLabs responded ${response.status}: ${detail.slice(0, MAX_ERROR_BODY)}`)

    error.status = response.status
    error.detail = parseDetail(detail)
    throw error
  }

  return response
}

// The API answers {"detail": {"code": ..., "status": ...}} on failures, and the
// codes are the only reliable way to tell a rejected key from an empty quota.
function parseDetail(body) {
  try {
    return JSON.parse(body)?.detail ?? null
  }
  catch {
    return null
  }
}

export async function synthesize(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID

  if (!voiceId)
    throw new Error('Missing ELEVENLABS_VOICE_ID.')

  const response = await request(`/text-to-speech/${voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  })

  return new Uint8Array(await response.arrayBuffer())
}

export async function fetchUsage() {
  const response = await request('/user/subscription')
  const { character_count: used, character_limit: limit } = await response.json()

  // An unrecognized shape must not read as an empty quota: the caller only
  // skips a line on a confirmed shortage.
  if (!Number.isFinite(used) || !Number.isFinite(limit))
    throw new Error('ElevenLabs returned a subscription without a usable character count.')

  return { used, limit }
}
