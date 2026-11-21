import type { JsonRecord } from '../core/json.ts'
import type { CommandBus, CommandContext, CommandSpec } from './spec.ts'

interface Route {
  readonly spec: CommandSpec
  readonly args: JsonRecord
}

export function chooseRoute(
  bus: CommandBus,
  text: string,
  choice: string | null,
  context: CommandContext,
): Route | null {
  const spec =
    choice !== null ? bus.specs.find((candidate) => candidate.name === choice) : undefined

  if (!spec || spec.fastRoute === false) {
    return null
  }

  if (spec.requiresQueue === true && !context.services.music.view(context.guildId)) {
    return { spec, args: {} }
  }

  const args = spec.parse ? spec.parse(text, context) : {}

  return args ? { spec, args } : null
}
