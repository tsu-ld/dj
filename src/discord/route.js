import { getAction } from '../actions/index.js'
import { MESSAGES } from '../messages.js'

// One place decides whether a confident Jev choice is directly actionable:
// route-only actions, queue preconditions first, then the action's own fast
// argument parser. Null means the dj's LLM should handle the request.
export function chooseRoute(text, choice, context) {
  const action = choice ? getAction(choice) : null

  if (!action?.route)
    return null

  if (action.requiresQueue && !context.queue)
    return { refusal: MESSAGES.nothingPlaying }

  const args = action.parse(text, context)

  return args ? { action, args } : null
}
