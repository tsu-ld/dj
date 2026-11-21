import { errorMessage, ProviderError } from '../core/errors.ts'

export const MAX_ERROR_BODY = 300

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function endpointHeaders(apiKey: string, sessionId: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'x-opencode-session': sessionId,
  }
}

export async function failedResponse(endpoint: string, response: Response): Promise<ProviderError> {
  const detail = await response.text().catch(() => '')

  return new ProviderError(
    `${endpoint} responded ${response.status}: ${detail.slice(0, MAX_ERROR_BODY)}`,
    { failure: isRetryableStatus(response.status) ? 'retryable' : 'fatal', status: response.status },
  )
}

export function mapFailure(error: unknown): ProviderError {
  if (error instanceof ProviderError)
    return error

  return new ProviderError(errorMessage(error), { failure: 'retryable', cause: error })
}
