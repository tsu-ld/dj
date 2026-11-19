export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export type ProviderFailure = 'retryable' | 'fatal' | 'quota'

// Provider failures carry the kind of failure, never the vendor behind it:
// callers decide what to do without knowing which service was picked.
export class ProviderError extends Error {
  readonly failure: ProviderFailure
  readonly status: number | null

  constructor(message: string, options: { failure: ProviderFailure, status?: number, cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = 'ProviderError'
    this.failure = options.failure
    this.status = options.status ?? null
  }
}

export class TimeoutError extends Error {
  constructor(message = 'The operation timed out.') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class ConfigError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
