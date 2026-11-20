import { afterEach, describe, expect, test } from 'bun:test'
import { json, restoreFetch, stubFetch } from '../../tests/http.ts'
import { failureFor, fetchSpeechUsage, isAuthFailure, SpeechRequestError, synthesizeSpeech } from '../client.ts'

const config = { apiKey: 'secret', voiceId: 'voice-1', model: 'eleven_v4', timeoutMs: 12_000 }

afterEach(restoreFetch)

describe('speech client', () => {
  test('the line is sent to the configured voice and model', async () => {
    const fetch = stubFetch(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const audio = await synthesizeSpeech(config, 'Hola')

    expect(Array.from(audio)).toEqual([1, 2, 3])
    expect(fetch.at(0).url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128')
    expect(new Headers(fetch.at(0).init?.headers).get('xi-api-key')).toBe('secret')
    expect(JSON.parse(String(fetch.at(0).init?.body))).toEqual({
      text: 'Hola',
      model_id: 'eleven_v4',
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    })
  })

  test('the model can be overridden', async () => {
    const fetch = stubFetch(async () => new Response(new Uint8Array(), { status: 200 }))

    await synthesizeSpeech({ ...config, model: 'eleven_flash_v2_5' }, 'Hola')

    expect(JSON.parse(String(fetch.at(0).init?.body))).toMatchObject({ model_id: 'eleven_flash_v2_5' })
  })

  test('a provider error surfaces the status and the failure without leaking the key', async () => {
    stubFetch(async () => new Response('{"detail":{"code":"unauthorized","status":"invalid_api_key"}}', { status: 401 }))

    let error: unknown

    try {
      await synthesizeSpeech(config, 'Hola')
    }
    catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(SpeechRequestError)

    if (!(error instanceof SpeechRequestError))
      throw new Error('Expected a speech request error')

    expect(error.message).toContain('Speech service responded 401')
    expect(error.status).toBe(401)
    expect(error.failure).toBe('fatal')
    expect(error.message).not.toContain('secret')
  })

  test('the subscription reports used and available characters', async () => {
    const fetch = stubFetch(async () => json({ character_count: 1200, character_limit: 10000 }))
    const usage = await fetchSpeechUsage(config)

    expect(usage).toEqual({ used: 1200, limit: 10000 })
    expect(fetch.at(0).url).toBe('https://api.elevenlabs.io/v1/user/subscription')
  })

  test('a subscription without a character count is an error, not an empty quota', async () => {
    stubFetch(async () => json({ character_count: null, character_limit: 10000 }))

    await expect(fetchSpeechUsage(config)).rejects.toThrow('usable character count')
  })
})

describe('failure classification', () => {
  test('only a rejected key is fatal, not an empty quota', () => {
    expect(isAuthFailure(401, { code: 'unauthorized', status: 'invalid_api_key' })).toBe(true)
    expect(isAuthFailure(403, null)).toBe(true)
    expect(isAuthFailure(401, { code: 'quota_exceeded', status: 'max_character_limit_exceeded' })).toBe(false)
    expect(isAuthFailure(401, { code: 'unusual_activity' })).toBe(false)
    expect(isAuthFailure(429, null)).toBe(false)

    expect(failureFor(401, { code: 'quota_exceeded', status: 'max_character_limit_exceeded' })).toBe('quota')
    expect(failureFor(401, null)).toBe('quota')
    expect(failureFor(402, null)).toBe('quota')
    expect(failureFor(403, null)).toBe('fatal')
    expect(failureFor(429, null)).toBe('retryable')
    expect(failureFor(500, null)).toBe('retryable')
  })
})
