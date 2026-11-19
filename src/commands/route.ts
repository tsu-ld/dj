import type { CommandBus, CommandContext, CommandSpec } from './spec.ts'

export interface Route {
  readonly spec: CommandSpec
  readonly args: Record<string, unknown>
}

// One place decides whether a confident choice is directly actionable:
// route-only commands, then the command's own fast argument parser. Null means
// the DJ should handle the request. A queue command with nothing playing still
// routes, so the bus answers with its one refusal instead of the DJ guessing.
export function chooseRoute(bus: CommandBus, text: string, choice: string | null, context: CommandContext): Route | null {
  const spec = choice !== null ? bus.specs.find(candidate => candidate.name === choice) : undefined

  if (!spec || spec.fastRoute === false)
    return null

  if (spec.requiresQueue === true && !context.queue)
    return { spec, args: {} }

  const args = spec.parse ? spec.parse(text, context) : {}

  return args ? { spec, args } : null
}
