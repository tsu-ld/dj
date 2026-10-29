import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../config.ts'
import { ConfigError } from '../core/errors.ts'

const TOKEN = { DISCORD_TOKEN: 'token' }

describe('loadConfig', () => {
  test('requires the bot token', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)

    try {
      loadConfig({})
    }
    catch (error) {
      expect((error as ConfigError).issues).toContain('DISCORD_TOKEN is required.')
    }
  })

  test('degrades every optional capability without failing', () => {
    const config = loadConfig(TOKEN)

    expect(config.discord.token).toBe('token')
    expect(config.language.enabled).toBe(false)
    expect(config.decision.enabled).toBe(false)
    expect(config.speech.enabled).toBe(false)
    expect(config.music.spotify.enabled).toBe(false)
    expect(config.logLevel).toBe('info')
  })

  test('enables the conversation only with both endpoint and key', () => {
    const partial = loadConfig({ ...TOKEN, OPENAI_BASE_URL: 'https://llm.example/v1/responses' })

    expect(partial.language.enabled).toBe(false)

    const full = loadConfig({
      ...TOKEN,
      OPENAI_BASE_URL: 'https://llm.example/v1/responses',
      OPENAI_API_KEY: 'key',
    })

    expect(full.language).toMatchObject({ enabled: true, model: 'deepseek-v4-flash' })
  })

  test('the decision falls back to the conversation key', () => {
    const config = loadConfig({
      ...TOKEN,
      JEV_BASE_URL: 'https://jev.example/v1/systemone',
      OPENAI_API_KEY: 'key',
    })

    expect(config.decision).toMatchObject({ enabled: true, apiKey: 'key' })
  })

  test('rejects a malformed url instead of silently disabling it', () => {
    expect(() => loadConfig({ ...TOKEN, OPENAI_BASE_URL: 'not a url' })).toThrow(ConfigError)
  })

  test('enables speech only with key and voice', () => {
    expect(loadConfig({ ...TOKEN, ELEVENLABS_API_KEY: 'key' }).speech.enabled).toBe(false)
    expect(loadConfig({ ...TOKEN, ELEVENLABS_VOICE_ID: 'voice' }).speech.enabled).toBe(false)
    expect(loadConfig({ ...TOKEN, ELEVENLABS_API_KEY: 'key', ELEVENLABS_VOICE_ID: 'voice' }).speech.enabled).toBe(true)
  })
})
