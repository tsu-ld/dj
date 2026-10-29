import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { DecisionInput, DecisionPort } from '../../ports/decision.ts'
import { circuitBreaker } from '../../core/async.ts'
import { errorMessage, ProviderError } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'

type DecisionConfig = Extract<AppConfig['decision'], { enabled: true }>

const INSTRUCTIONS = 'What does the user want the bot to do? Pick the single option that fits best.'

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function mapFailure(error: unknown): ProviderError {
  if (error instanceof ProviderError)
    return error

  return new ProviderError('decision', errorMessage(error), { failure: 'retryable', cause: error })
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)

  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function decide(config: DecisionConfig, input: DecisionInput): Promise<string | null> {
  const criteria = Object.fromEntries(input.options.map(option => [option.name, option.description]))

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  }

  if (input.sessionId)
    headers['x-opencode-session'] = input.sessionId

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      state: { ...input.state, message: input.text },
      questions: {
        action: { type: 'choice', instructions: INSTRUCTIONS, criteria },
      },
    }),
    signal: requestSignal(config.timeoutMs, input.signal),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')

    throw new ProviderError(
      'decision',
      `Decision endpoint responded ${response.status}: ${detail}`,
      { failure: isRetryableStatus(response.status) ? 'retryable' : 'fatal', status: response.status },
    )
  }

  const payload = parseJson(await response.text())

  if (!isRecord(payload)) {
    throw new ProviderError(
      'decision',
      'Decision endpoint returned an invalid payload',
      { failure: 'retryable', status: response.status },
    )
  }

  const answers = payload.answers
  const answer = isRecord(answers) ? answers.action : undefined

  if (!isRecord(answer))
    return null

  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0
  const choice = typeof answer.choice === 'string' ? answer.choice : null

  if (choice === null || confidence < config.minConfidence)
    return null

  // The endpoint is external input: a label outside the offered options is
  // not a decision this caller can act on.
  return Object.hasOwn(criteria, choice) ? choice : null
}

export function intentClassifier(deps: {
  config: AppConfig['decision']
  logger: Logger
  clock: Clock
}): DecisionPort {
  const { config, logger, clock } = deps

  if (!config.enabled)
    return { choose: async () => null }

  // The endpoint can be down or out of quota for a while; retrying on every
  // message would add seconds to commands that the dj can route itself.
  const breaker = circuitBreaker({
    threshold: 1,
    cooldownMs: config.retryAfterMs,
    now: () => clock.now(),
  })

  return {
    async choose(input) {
      if (!breaker.allow())
        return null

      try {
        const choice = await decide(config, input)

        breaker.success()

        return choice
      }
      catch (error) {
        // A caller cancellation is not a provider failure; opening the breaker
        // would take the fast path down for a request nobody is waiting on.
        if (input.signal?.aborted) {
          breaker.success()

          throw error
        }

        breaker.failure()
        logger.error('classifier.failed', error)

        throw mapFailure(error)
      }
    },
  }
}
