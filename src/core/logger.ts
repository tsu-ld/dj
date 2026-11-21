import type { Clock } from './clock.ts'
import { isRecord } from './json.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogFields = Record<string, unknown>

export interface Logger {
  debug: (event: string, fields?: LogFields) => void
  info: (event: string, fields?: LogFields) => void
  warn: (event: string, fields?: LogFields) => void
  error: (event: string, error?: unknown, fields?: LogFields) => void
  child: (fields: LogFields) => Logger
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const SECRET_KEY = /api[_-]?key|authorization|password|secret|token/i
const MAX_DEPTH = 4

function sanitize(value: unknown, depth = 0): unknown {
  if (!Array.isArray(value) && !isRecord(value))
    return value

  if (depth >= MAX_DEPTH)
    return '[depth limit]'

  if (Array.isArray(value))
    return value.slice(0, 20).map(item => sanitize(item, depth + 1))

  return sanitizeFields(value, depth)
}

function sanitizeFields(fields: LogFields, depth = 0): LogFields {
  return Object.fromEntries(Object.entries(fields).map(([key, entry]) => [key, SECRET_KEY.test(key) ? '[redacted]' : sanitize(entry, depth + 1)]))
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause === undefined ? {} : { cause: describeError(error.cause) }),
    }
  }

  return { message: String(error) }
}

export function logger(options: { level: LogLevel, clock: Clock, out: { write: (text: string) => unknown } }): Logger {
  function build(base: LogFields): Logger {
    function write(level: LogLevel, event: string, error?: unknown, fields?: LogFields): void {
      if (LEVEL_VALUE[level] < LEVEL_VALUE[options.level])
        return

      const payload = {
        level,
        time: new Date(options.clock.now()).toISOString(),
        event,
        ...sanitizeFields(base),
        ...sanitizeFields(fields ?? {}),
        ...(error === undefined ? {} : { error: describeError(error) }),
      }

      try {
        options.out.write(`${JSON.stringify(payload)}\n`)
      }
      catch {
        options.out.write(`{"level":"error","event":"logger.failed","original":${JSON.stringify(event)}}\n`)
      }
    }

    return {
      debug: (event, fields) => write('debug', event, undefined, fields),
      info: (event, fields) => write('info', event, undefined, fields),
      warn: (event, fields) => write('warn', event, undefined, fields),
      error: (event, error, fields) => write('error', event, error, fields),
      child: fields => build({ ...base, ...fields }),
    }
  }

  return build({})
}
