import process from 'node:process'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { fitsQuota, isAuthFailure, renderSpeech } from '../speech.js'

const keys = ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL_ID']

beforeEach(() => {
  for (const key of keys)
    delete process.env[key]
})

afterEach(() => {
  for (const key of keys)
    delete process.env[key]
})

test('a line only fits while the monthly quota covers it', () => {
  expect(fitsQuota({ used: 0, limit: 10_000 }, 110)).toBe(true)
  expect(fitsQuota({ used: 9_950, limit: 10_000 }, 110)).toBe(false)
  expect(fitsQuota({ used: 9_950, limit: 10_000 }, 50)).toBe(true)
})

test('without a voice configured nothing is synthesized', async () => {
  expect(await renderSpeech('Hola')).toBeNull()
})

test('without a voice id the key alone is not enough', async () => {
  process.env.ELEVENLABS_API_KEY = 'key'

  expect(await renderSpeech('Hola')).toBeNull()
})

test('a line over the hard cap is dropped before it costs credits', async () => {
  process.env.ELEVENLABS_API_KEY = 'key'
  process.env.ELEVENLABS_VOICE_ID = 'voice'

  expect(await renderSpeech('x'.repeat(301))).toBeNull()
})

test('only a rejected key turns the radio off, not an empty quota', () => {
  expect(isAuthFailure({ status: 401, detail: { code: 'unauthorized', status: 'invalid_api_key' } })).toBe(true)
  expect(isAuthFailure({ status: 403, detail: null })).toBe(true)
  expect(isAuthFailure({ status: 401, detail: { code: 'quota_exceeded', status: 'max_character_limit_exceeded' } })).toBe(false)
  expect(isAuthFailure({ status: 401, detail: { code: 'unusual_activity' } })).toBe(false)
  expect(isAuthFailure({ status: 429, detail: null })).toBe(false)
})
