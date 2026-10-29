import process from 'node:process'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFields = Record<string, unknown>

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
  if (value === null || typeof value !== 'object')
    return value

  if (depth >= MAX_DEPTH)
    return '[depth limit]'

  if (Array.isArray(value))
    return value.slice(0, 20).map(item => sanitize(item, depth + 1))

  const clean: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    clean[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitize(entry, depth + 1)
  }

  return clean
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

export function logger(options: { level: LogLevel, sink?: (line: string) => void, now?: () => number }): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`))
  const now = options.now ?? (() => Date.now())

  function build(base: LogFields): Logger {
    function write(level: LogLevel, event: string, error?: unknown, fields?: LogFields): void {
      if (LEVEL_VALUE[level] < LEVEL_VALUE[options.level])
        return

      const payload = {
        level,
        time: new Date(now()).toISOString(),
        event,
        ...sanitize(base) as LogFields,
        ...sanitize(fields ?? {}) as LogFields,
        ...(error === undefined ? {} : { error: describeError(error) }),
      }

      try {
        sink(JSON.stringify(payload))
      }
      catch {
        sink(`{"level":"error","event":"logger.failed","original":${JSON.stringify(event)}}`)
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
