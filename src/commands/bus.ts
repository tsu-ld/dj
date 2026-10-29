import type { Logger } from '../core/logger.ts'
import type { ToolSpec } from '../ports/conversation.ts'
import type { DecisionOption } from '../ports/decision.ts'
import type { CommandBus, CommandContext, CommandOutcome, CommandSpec } from './spec.ts'
import { isUserError } from '../core/errors.ts'
import { MESSAGES } from '../messages.ts'

function toTool(spec: CommandSpec): ToolSpec {
  return { name: spec.name, description: spec.description, parameters: spec.parameters }
}

function toRoute(spec: CommandSpec): DecisionOption {
  return { name: spec.name, description: spec.description }
}

// One executor for every entry point: the fast router, the model's tool calls
// and the now-playing buttons all land here, so preconditions, authorization,
// confirmation and error mapping are written once.
export function commandBus(deps: { specs: readonly CommandSpec[], logger: Logger }): CommandBus {
  const byName = new Map(deps.specs.map(spec => [spec.name, spec]))
  const tools = deps.specs.filter(spec => spec.modelTool !== false).map(toTool)
  const routes = deps.specs.filter(spec => spec.fastRoute !== false).map(toRoute)

  async function run(name: string, args: Record<string, unknown>, context: CommandContext): Promise<CommandOutcome> {
    const spec = byName.get(name)

    if (!spec) {
      deps.logger.warn('command.unknown', { name })

      return { kind: 'failed', error: new Error(`Unknown command: ${name}`), message: `there is no tool called ${name}` }
    }

    let scoped = context

    if (spec.requiresQueue) {
      const queue = context.services.music.view(context.guildId)

      if (!queue) {
        await context.ui.error(MESSAGES.nothingPlaying)

        return { kind: 'refused', message: MESSAGES.nothingPlaying }
      }

      scoped = withQueue(context, queue)
    }

    if (spec.requiresVoice && !scoped.voiceChannel) {
      await scoped.ui.error(MESSAGES.joinVoiceChannel)

      return { kind: 'refused', message: MESSAGES.joinVoiceChannel }
    }

    try {
      spec.authorize?.(scoped)

      const data = await spec.run(args, scoped)
      const confirmation = spec.confirm?.(data, scoped) ?? null

      if (confirmation !== null)
        await scoped.ui.reply(confirmation)
      else if (spec.ack !== false)
        await scoped.ui.ack()

      return { kind: 'ok', data }
    }
    catch (error) {
      if (isUserError(error)) {
        await scoped.ui.error(error.message)

        return { kind: 'refused', message: error.message }
      }

      deps.logger.error('command.failed', error, { name })
      await scoped.ui.error(MESSAGES.genericError)

      return { kind: 'failed', error }
    }
  }

  return {
    specs: deps.specs,
    tools,
    routes,
    run,
    async runTool(name, args, context) {
      const spec = byName.get(name)

      // A command that is not a model tool must not become executable because
      // the model guessed its name: query joins voice, toggle changes playback.
      if (!spec || spec.modelTool === false) {
        deps.logger.warn('command.not_a_tool', { name })

        return Promise.resolve({
          kind: 'failed',
          error: new Error(`Unknown tool: ${name}`),
          message: `there is no tool called ${name}`,
        })
      }

      return run(name, args, context)
    },
  }
}

function withQueue(context: CommandContext, queue: NonNullable<CommandContext['queue']>): CommandContext {
  return { ...context, queue }
}
