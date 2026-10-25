import process from 'node:process'

const DECISION_TIMEOUT_MS = 5_000
const MIN_CONFIDENCE = 0.6
const RETRY_AFTER_FAILURE_MS = 60_000

const INSTRUCTIONS = 'What does the user want the bot to do? Pick the single option that fits best.'

let retryAt = 0

export function resetDecisionCooldown() {
  retryAt = 0
}

// A System One decision: typed options in, one label and its probability out.
// The caller supplies the options so this stays independent of the registry.
export async function chooseAction({ text, state, options, sessionId }) {
  const endpoint = process.env.JEV_BASE_URL
  const apiKey = process.env.JEV_API_KEY || process.env.OPENAI_API_KEY

  if (!endpoint || !apiKey || Date.now() < retryAt)
    return null

  const model = process.env.JEV_MODEL || 'jev-1.13-free'
  const criteria = Object.fromEntries(options.map(option => [option.name, option.description]))

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(sessionId && { 'x-opencode-session': sessionId }),
      },
      body: JSON.stringify({
        model,
        state: { ...state, message: text },
        questions: {
          action: { type: 'choice', instructions: INSTRUCTIONS, criteria },
        },
      }),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    })

    if (!response.ok)
      throw new Error(`Jev endpoint responded ${response.status}: ${await response.text()}`)

    const answer = (await response.json()).answers?.action

    if (!answer || (answer.confidence ?? 0) < MIN_CONFIDENCE)
      return null

    // The endpoint is external input: a label outside the offered options is
    // not a decision this caller can act on.
    return Object.hasOwn(criteria, answer.choice) ? answer.choice : null
  }
  catch (error) {
    // The endpoint can be down or out of quota for a while; retrying on every
    // message would add seconds to commands that the DJ can route itself.
    retryAt = Date.now() + RETRY_AFTER_FAILURE_MS
    throw error
  }
}
