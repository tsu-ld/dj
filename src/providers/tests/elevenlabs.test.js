import process from 'node:process'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { fetchUsage, synthesize } from '../elevenlabs.js'

const realFetch = globalThis.fetch
const keys = ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID']
const calls = []

function stubFetch(response) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })

    return response
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  calls.length = 0

  for (const key of keys)
    delete process.env[key]
})

afterEach(() => {
  globalThis.fetch = realFetch

  for (const key of keys)
    delete process.env[key]
})

test('the line is sent to the configured voice and model', async () => {
  process.env.ELEVENLABS_API_KEY = 'secret'
  process.env.ELEVENLABS_VOICE_ID = 'voice-1'
  stubFetch(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))

  const audio = await synthesize('Hola')

  expect(Array.from(audio)).toEqual([1, 2, 3])
  expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128')
  expect(calls[0].init.headers['xi-api-key']).toBe('secret')
  expect(JSON.parse(calls[0].init.body)).toEqual({
    text: 'Hola',
    model_id: 'eleven_v4',
    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
  })
})

test('a provider error surfaces the status, the detail and does not leak the key', async () => {
  process.env.ELEVENLABS_API_KEY = 'secret'
  process.env.ELEVENLABS_VOICE_ID = 'voice-1'
  stubFetch(new Response('{"detail":{"code":"unauthorized","status":"invalid_api_key"}}', { status: 401 }))

  const error = await synthesize('Hola').catch(caught => caught)

  expect(error.message).toContain('ElevenLabs responded 401')
  expect(error.status).toBe(401)
  expect(error.detail).toEqual({ code: 'unauthorized', status: 'invalid_api_key' })
  expect(error.message).not.toContain('secret')
})

test('the model can be overridden', async () => {
  process.env.ELEVENLABS_API_KEY = 'secret'
  process.env.ELEVENLABS_VOICE_ID = 'voice-1'
  process.env.ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5'
  stubFetch(new Response(new Uint8Array(), { status: 200 }))

  await synthesize('Hola')

  expect(JSON.parse(calls[0].init.body).model_id).toBe('eleven_flash_v2_5')
})

test('the subscription reports used and available characters', async () => {
  process.env.ELEVENLABS_API_KEY = 'secret'
  stubFetch(jsonResponse({ character_count: 1200, character_limit: 10000 }))

  expect(await fetchUsage()).toEqual({ used: 1200, limit: 10000 })
  expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/user/subscription')
})

test('a subscription without a character count is an error, not an empty quota', async () => {
  process.env.ELEVENLABS_API_KEY = 'secret'
  stubFetch(jsonResponse({ character_count: null, character_limit: 10000 }))

  await expect(fetchUsage()).rejects.toThrow('usable character count')
})
