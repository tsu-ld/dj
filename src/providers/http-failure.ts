import { errorMessage, ProviderError } from '../core/errors.ts'

export const MAX_ERROR_BODY = 300

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function mapFailure(error: unknown): ProviderError {
  if (error instanceof ProviderError)
    return error

  return new ProviderError(errorMessage(error), { failure: 'retryable', cause: error })
}
