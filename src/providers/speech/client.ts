import type { ProviderFailure } from '../../core/errors.ts'
import { ProviderError } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'

const API_BASE = 'https://api.elevenlabs.io/v1'
const OUTPUT_FORMAT = 'mp3_44100_128'
const MAX_ERROR_BODY = 300

// The API answers {"detail": {"code": ..., "status": ...}} on failures; the
// codes are the only reliable way to tell a rejected key from an empty quota.
const AUTH_FAILURES = new Set(['invalid_api_key', 'authentication_error'])

// Lower stability buys more emotional range; the voice is directed with audio
// tags in the text, so it does not need a fixed baseline performance.
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.8 }

export interface SpeechUsage {
  readonly used: number
  readonly limit: number
}

export interface SpeechClientConfig {
  readonly apiKey: string
  readonly voiceId: string
  readonly model: string
  readonly timeoutMs: number
}

export interface SpeechClient {
  synthesize: (text: string) => Promise<Uint8Array>
  fetchUsage: () => Promise<SpeechUsage>
}

function detailCode(detail: unknown, key: 'code' | 'status'): string | null {
  if (!isRecord(detail))
    return null

  const value = detail[key]

  return typeof value === 'string' ? value : null
}

// A 401 is not always a bad key: the provider also answers 401 when the quota
// is gone. Only the codes that mean "this key will never work" latch.
export function isAuthFailure(status: number, detail: unknown): boolean {
  return status === 403
    || AUTH_FAILURES.has(detailCode(detail, 'code') ?? '')
    || AUTH_FAILURES.has(detailCode(detail, 'status') ?? '')
}

// The failure is mapped once, here, so the capability never parses a status.
export function failureFor(status: number, detail: unknown): ProviderFailure {
  if (isAuthFailure(status, detail))
    return 'fatal'

  if (status === 401 || status === 402)
    return 'quota'

  return 'retryable'
}

export class SpeechRequestError extends ProviderError {
  readonly detail: unknown

  constructor(status: number, body: string, detail: unknown) {
    super('speech', `Speech service responded ${status}: ${body.slice(0, MAX_ERROR_BODY)}`, {
      failure: failureFor(status, detail),
      status,
    })
    this.name = 'SpeechRequestError'
    this.detail = detail
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

async function synthesize(config: SpeechClientConfig, text: string): Promise<Uint8Array> {
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

async function fetchUsage(config: SpeechClientConfig): Promise<SpeechUsage> {
  const response = await request(config, '/user/subscription')
  const payload: unknown = await response.json()
  const used = isRecord(payload) ? payload.character_count : null
  const limit = isRecord(payload) ? payload.character_limit : null

  // An unrecognized shape must not read as an empty quota: the caller only
  // skips a line on a confirmed shortage.
  if (typeof used !== 'number' || typeof limit !== 'number' || !Number.isFinite(used) || !Number.isFinite(limit))
    throw new Error('Speech service returned a subscription without a usable character count.')

  return { used, limit }
}

export function speechClient(config: SpeechClientConfig): SpeechClient {
  return {
    synthesize: async text => synthesize(config, text),
    fetchUsage: async () => fetchUsage(config),
  }
}
