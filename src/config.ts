import type { LogLevel } from './core/logger.ts'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { ConfigError } from './core/errors.ts'

export interface AppConfig {
  readonly discord: { readonly token: string }
  readonly settingsPath: string
  readonly logLevel: LogLevel
  readonly music: {
    readonly cacheDir: string
    readonly cacheMaxBytes: number
    readonly cacheMaxAgeMs: number
    readonly extractorCommand: string
    readonly metadata: { readonly enabled: true, readonly clientId: string, readonly clientSecret: string } | { readonly enabled: false }
  }
  readonly language: {
    readonly enabled: true
    readonly baseUrl: string
    readonly apiKey: string
    readonly model: string
    readonly timeoutMs: number
    readonly maxOutputTokens: number
  } | { readonly enabled: false }
  readonly decision: {
    readonly enabled: true
    readonly baseUrl: string
    readonly apiKey: string
    readonly model: string
    readonly timeoutMs: number
    readonly minConfidence: number
    readonly retryAfterMs: number
  } | { readonly enabled: false }
  readonly speech: {
    readonly enabled: true
    readonly apiKey: string
    readonly voiceId: string
    readonly model: string
    readonly timeoutMs: number
    readonly maxChars: number
    readonly quotaCacheMs: number
  } | { readonly enabled: false }
  readonly cooldowns: {
    readonly plainRequestMs: number
    readonly djRequestMs: number
  }
}

const LOG_LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])
const DEFAULT_LLM_MODEL = 'deepseek-v4-flash'
const DEFAULT_DECISION_MODEL = 'jev-1.13-free'
const DEFAULT_SPEECH_MODEL = 'eleven_v4'

function text(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim()

  return value === undefined || value === '' ? null : value
}

function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number, issues: string[]): number {
  const raw = text(env, key)

  if (raw === null)
    return fallback

  const value = Number(raw)

  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`${key} must be a positive integer.`)

    return fallback
  }

  return value
}

function httpUrl(env: NodeJS.ProcessEnv, key: string, issues: string[]): string | null {
  const raw = text(env, key)

  if (raw === null)
    return null

  try {
    const url = new URL(raw)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      issues.push(`${key} must be an http or https URL.`)

      return null
    }

    return raw
  }
  catch {
    issues.push(`${key} must be a valid URL.`)

    return null
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const issues: string[] = []
  const token = text(env, 'DISCORD_TOKEN')

  if (token === null)
    issues.push('DISCORD_TOKEN is required.')

  const logLevelRaw = text(env, 'LOG_LEVEL') ?? 'info'
  const logLevel = LOG_LEVELS.has(logLevelRaw as LogLevel) ? logLevelRaw as LogLevel : 'info'

  if (!LOG_LEVELS.has(logLevelRaw as LogLevel))
    issues.push(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}.`)

  const languageUrl = httpUrl(env, 'LLM_BASE_URL', issues)
  const languageKey = text(env, 'LLM_API_KEY')
  const language = languageUrl !== null && languageKey !== null
    ? {
        enabled: true as const,
        baseUrl: languageUrl,
        apiKey: languageKey,
        model: text(env, 'LLM_MODEL') ?? DEFAULT_LLM_MODEL,
        timeoutMs: positiveInt(env, 'LLM_TIMEOUT_MS', 40_000, issues),
        maxOutputTokens: positiveInt(env, 'LLM_MAX_OUTPUT_TOKENS', 800, issues),
      }
    : { enabled: false as const }

  const decisionUrl = httpUrl(env, 'DECISION_BASE_URL', issues)
  const decisionKey = text(env, 'DECISION_API_KEY')
  const decision = decisionUrl !== null && decisionKey !== null
    ? {
        enabled: true as const,
        baseUrl: decisionUrl,
        apiKey: decisionKey,
        model: text(env, 'DECISION_MODEL') ?? DEFAULT_DECISION_MODEL,
        timeoutMs: positiveInt(env, 'DECISION_TIMEOUT_MS', 5_000, issues),
        minConfidence: 0.6,
        retryAfterMs: 60_000,
      }
    : { enabled: false as const }

  const speechKey = text(env, 'SPEECH_API_KEY')
  const speechVoice = text(env, 'SPEECH_VOICE_ID')
  const speech = speechKey !== null && speechVoice !== null
    ? {
        enabled: true as const,
        apiKey: speechKey,
        voiceId: speechVoice,
        model: text(env, 'SPEECH_MODEL_ID') ?? DEFAULT_SPEECH_MODEL,
        timeoutMs: positiveInt(env, 'SPEECH_TIMEOUT_MS', 12_000, issues),
        maxChars: 300,
        quotaCacheMs: 300_000,
      }
    : { enabled: false as const }

  const metadataId = text(env, 'MUSIC_METADATA_CLIENT_ID')
  const metadataSecret = text(env, 'MUSIC_METADATA_CLIENT_SECRET')
  const musicMetadata = metadataId !== null && metadataSecret !== null
    ? { enabled: true as const, clientId: metadataId, clientSecret: metadataSecret }
    : { enabled: false as const }

  if (issues.length > 0)
    throw new ConfigError(issues)

  return {
    discord: { token: token ?? '' },
    settingsPath: resolve(import.meta.dirname, '../data/guilds.json'),
    logLevel,
    music: {
      cacheDir: join(tmpdir(), 'dj-audio'),
      cacheMaxBytes: 512 * 1024 * 1024,
      cacheMaxAgeMs: 86_400_000,
      extractorCommand: text(env, 'EXTRACTOR_COMMAND') ?? 'yt-dlp',
      metadata: musicMetadata,
    },
    language,
    decision,
    speech,
    cooldowns: {
      plainRequestMs: 2_000,
      djRequestMs: 15_000,
    },
  }
}
