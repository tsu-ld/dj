export class UserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UserError'
  }
}

export type ProviderFailure = 'retryable' | 'fatal' | 'quota'

export class ProviderError extends Error {
  readonly failure: ProviderFailure
  readonly status: number | null

  constructor(
    message: string,
    options: { failure: ProviderFailure; status?: number; cause?: unknown },
  ) {
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
  constructor(issues: ReadonlyArray<string>) {
    super(`Invalid configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
