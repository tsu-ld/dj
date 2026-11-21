import type { ProviderFailure } from '../../core/errors.ts'
import { ProviderError } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { MAX_ERROR_BODY } from '../endpoint.ts'

const API_BASE = 'https://api.elevenlabs.io/v1'
const OUTPUT_FORMAT = 'mp3_44100_128'

// The API answers 401 for an exhausted quota too; only these detail codes mean a rejected key.
const AUTH_FAILURES = new Set(['invalid_api_key', 'authentication_error'])

const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 }

export interface SpeechUsage {
  readonly used: number
  readonly limit: number
}

interface SpeechClientConfig {
  readonly apiKey: string
  readonly voiceId: string
  readonly model: string
  readonly timeoutMs: number
}

function detailCode(detail: unknown, key: 'code' | 'status'): string | null {
  if (!isRecord(detail))
    return null

  const value = detail[key]

  return typeof value === 'string' ? value : null
}

function isAuthFailure(status: number, detail: unknown): boolean {
  return status === 403
    || AUTH_FAILURES.has(detailCode(detail, 'code') ?? '')
    || AUTH_FAILURES.has(detailCode(detail, 'status') ?? '')
}

function failureFor(status: number, detail: unknown): ProviderFailure {
  if (isAuthFailure(status, detail))
    return 'fatal'

  if (status === 401 || status === 402)
    return 'quota'

  return 'retryable'
}

export class SpeechRequestError extends ProviderError {
  constructor(status: number, body: string, detail: unknown) {
    super(`Speech service responded ${status}: ${body.slice(0, MAX_ERROR_BODY)}`, {
      failure: failureFor(status, detail),
      status,
    })
    this.name = 'SpeechRequestError'
  }
}

function parseDetail(body: string): unknown {
  const payload = parseJson(body)

  if (!isRecord(payload))
    return null

  return payload.detail ?? null
}

async function request(config: SpeechClientConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)

  headers.set('xi-api-key', config.apiKey)

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    const body = await response.text()

    throw new SpeechRequestError(response.status, body, parseDetail(body))
  }

  return response
}

export async function synthesizeSpeech(config: SpeechClientConfig, text: string): Promise<Uint8Array> {
  const response = await request(config, `/text-to-speech/${config.voiceId}?output_format=${OUTPUT_FORMAT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: config.model,
      voice_settings: VOICE_SETTINGS,
    }),
  })

  return new Uint8Array(await response.arrayBuffer())
}

export async function fetchSpeechUsage(config: SpeechClientConfig): Promise<SpeechUsage> {
  const response = await request(config, '/user/subscription')
  const payload: unknown = await response.json()
  const used = isRecord(payload) ? payload.character_count : null
  const limit = isRecord(payload) ? payload.character_limit : null

  if (typeof used !== 'number' || typeof limit !== 'number' || !Number.isFinite(used) || !Number.isFinite(limit))
    throw new Error('Speech service returned a subscription without a usable character count.')

  return { used, limit }
}
