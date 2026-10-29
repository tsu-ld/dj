import type { CommandContext, CommandSpec } from './spec.ts'
import { MESSAGES } from '../messages.ts'
import { commands } from './index.ts'

export type Route
  = | { readonly spec: CommandSpec, readonly args: Record<string, unknown> }
    | { readonly refusal: string }

// One place decides whether a confident choice is directly actionable:
// route-only commands, the queue precondition, then the command's own fast
// argument parser. Null means the DJ should handle the request.
export function chooseRoute(text: string, choice: string | null, context: CommandContext): Route | null {
  const spec = choice !== null ? commands.find(candidate => candidate.name === choice) : undefined

  if (!spec || spec.fastRoute === false)
    return null

  if (spec.requiresQueue && !context.queue)
    return { refusal: MESSAGES.nothingPlaying }

  const args = spec.parse ? spec.parse(text, context) : {}

  return args ? { spec, args } : null
}
