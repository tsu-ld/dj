import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { DecisionInput, DecisionPort } from '../../ports/decision.ts'
import { circuitBreaker } from '../../core/async.ts'
import { ProviderError } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { endpointHeaders, failedResponse, mapFailure } from '../endpoint.ts'

type DecisionConfig = Extract<AppConfig['decision'], { enabled: true }>

const INSTRUCTIONS = 'What does the user want the bot to do? Pick the single option that fits best.'

async function decide(config: DecisionConfig, input: DecisionInput): Promise<string | null> {
  const criteria = Object.fromEntries(
    input.options.map((option) => [option.name, option.description]),
  )

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: endpointHeaders(config.apiKey, input.sessionId),
    body: JSON.stringify({
      model: config.model,
      state: { ...input.state, message: input.text },
      questions: {
        action: { type: 'choice', instructions: INSTRUCTIONS, criteria },
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    throw await failedResponse('Decision endpoint', response)
  }

  const payload = parseJson(await response.text())

  if (!isRecord(payload)) {
    throw new ProviderError('Decision endpoint returned an invalid payload', {
      failure: 'retryable',
      status: response.status,
    })
  }

  const answers = payload.answers
  const answer = isRecord(answers) ? answers.action : undefined

  if (!isRecord(answer)) {
    return null
  }

  const confidence = typeof answer.confidence === 'number' ? answer.confidence : 0
  const choice = typeof answer.choice === 'string' ? answer.choice : null

  if (choice === null || confidence < config.minConfidence) {
    return null
  }

  return Object.hasOwn(criteria, choice) ? choice : null
}

export function intentClassifier(deps: {
  config: AppConfig['decision']
  clock: Clock
}): DecisionPort {
  const { config, clock } = deps

  if (!config.enabled) {
    return { choose: async () => null }
  }

  const breaker = circuitBreaker({
    cooldownMs: config.retryAfterMs,
    clock,
  })

  return {
    async choose(input) {
      if (!breaker.allow()) {
        return null
      }

      try {
        const choice = await decide(config, input)

        breaker.success()

        return choice
      } catch (error) {
        breaker.failure()

        throw mapFailure(error)
      }
    },
  }
}
