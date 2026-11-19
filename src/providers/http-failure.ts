import { errorMessage, ProviderError } from '../core/errors.ts'

// An error body is for the log, not the whole page a gateway sent back.
export const MAX_ERROR_BODY = 300

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

// Anything that is not already a mapped failure happened on the wire before an
// answer: worth another try later, never a fatal verdict.
export function mapFailure(error: unknown): ProviderError {
  if (error instanceof ProviderError)
    return error

  return new ProviderError(errorMessage(error), { failure: 'retryable', cause: error })
}
