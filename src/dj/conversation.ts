import type { CommandBus, CommandContext, CommandOutcome } from '../commands/spec.ts'
import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ChatMessage, ConversationPort, ToolCall } from '../ports/conversation.ts'
import type { SettingsPort } from '../ports/settings.ts'
import { isRecord, parseJson } from '../core/json.ts'
import { clampMessage } from '../core/text.ts'
import { MESSAGES } from '../messages.ts'
import { conversationHistory } from './history.ts'
import { buildConversationInstructions } from './prompts.ts'

const DJ_TIMEOUT_MS = 40_000
const ASK_DEADLINE_MS = 60_000
// Three rounds to act through the tools, then one forced spoken answer: a
// model that keeps calling tools until the cap would otherwise act in silence.
const MAX_TOOL_ROUNDS = 3
const MAX_TOOL_CALLS_PER_ROUND = 4
const MAX_TOOL_CALLS = 8

const TIMEOUT_RESULT = 'the request ran out of time'
const CAP_RESULT = 'too many tool calls; try fewer at once'
const INVALID_ARGUMENTS_RESULT = 'those arguments were not valid JSON'
const FAILED_RESULT = 'the player could not do that'

// The dj already answers in its own words; a tool call must not also ack, react
// or announce a confirmation in the channel. The old tool path ran actions
// without the command feedback loop, and this keeps that behavior when the
// shared bus owns the execution. Showing the queue stays visible: that tool
// exists to post the queue card.
const SILENT_UI: Omit<CommandContext['ui'], 'showQueue'> = {
  reply: async () => {},
  error: async () => {},
  ack: async () => {},
}

export interface AskInput {
  request: string
  context: CommandContext
}

export interface DjAgent {
  ask: (input: AskInput) => Promise<string | null>
}

function toolResult(call: ToolCall, payload: Record<string, unknown>): ChatMessage {
  return { role: 'tool', toolCallId: call.id, content: JSON.stringify(payload) }
}

async function resolveToolCall(
  call: ToolCall,
  context: CommandContext,
  bus: CommandBus,
  logger: Logger,
): Promise<{ message: ChatMessage, acted: boolean }> {
  const args = parseJson(call.arguments)

  if (!isRecord(args))
    return { message: toolResult(call, { error: INVALID_ARGUMENTS_RESULT }), acted: false }

  function failed(error: unknown, message?: string): { message: ChatMessage, acted: boolean } {
    logger.error('dj.tool_failed', error, { tool: call.name })

    return { message: toolResult(call, { error: message ?? FAILED_RESULT }), acted: false }
  }

  try {
    const outcome: CommandOutcome = await bus.runTool(call.name, args, context)

    if (outcome.kind === 'ok')
      return { message: toolResult(call, outcome.data ?? { done: call.name }), acted: true }

    if (outcome.kind === 'refused')
      return { message: toolResult(call, { error: outcome.message }), acted: false }

    return failed(outcome.error, outcome.message)
  }
  catch (error) {
    return failed(error)
  }
}

export function djAgent(deps: {
  model: ConversationPort
  bus: CommandBus
  settings: SettingsPort
  logger: Logger
  clock: Clock
}): DjAgent {
  const history = conversationHistory({ clock: deps.clock })

  return {
    async ask(input) {
      const { context } = input
      const channelId = context.textChannel.id
      const userId = context.message?.author.id ?? null
      const deadline = deps.clock.now() + ASK_DEADLINE_MS
      const settings = deps.settings.get(context.guildId)
      const exchange: ChatMessage[] = [
        ...history.recall(channelId, userId),
        { role: 'user', content: input.request },
      ]
      const toolContext: CommandContext = {
        ...context,
        ui: { ...SILENT_UI, showQueue: async view => context.ui.showQueue(view) },
      }

      const instructions = () => buildConversationInstructions(
        settings,
        context.services.music.view(context.guildId),
      )
      const remainingBudget = () => {
        const remaining = deadline - deps.clock.now()

        return remaining > 0 ? Math.min(DJ_TIMEOUT_MS, remaining) : null
      }
      const typing = () => {
        void context.textChannel.sendTyping().catch(() => {})
      }

      let acted = false
      let toolCalls = 0

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const timeoutMs = remainingBudget()

          if (timeoutMs === null)
            break

          typing()

          const reply = await deps.model.complete({
            instructions: instructions(),
            messages: [...exchange],
            tools: deps.bus.tools,
            timeoutMs,
            sessionId: channelId,
          })

          exchange.push({
            role: 'assistant',
            content: reply.text,
            ...(reply.toolCalls.length > 0 ? { toolCalls: reply.toolCalls } : {}),
          })

          if (reply.toolCalls.length === 0) {
            history.remember(channelId, userId, exchange)

            return clampMessage(reply.text) ?? (acted ? MESSAGES.djActed : null)
          }

          let callsThisRound = 0

          for (const call of reply.toolCalls) {
            callsThisRound++

            if (remainingBudget() === null) {
              exchange.push(toolResult(call, { error: TIMEOUT_RESULT }))

              continue
            }

            if (callsThisRound > MAX_TOOL_CALLS_PER_ROUND || toolCalls >= MAX_TOOL_CALLS) {
              exchange.push(toolResult(call, { error: CAP_RESULT }))

              continue
            }

            toolCalls++

            // The queue changes between calls (adding songs creates it), so
            // every tool sees the live view, exactly as the old tool runner did.
            const callContext: CommandContext = {
              ...toolContext,
              queue: context.services.music.view(context.guildId),
            }
            const outcome = await resolveToolCall(call, callContext, deps.bus, deps.logger)

            acted ||= outcome.acted
            exchange.push(outcome.message)
          }
        }

        const timeoutMs = remainingBudget()

        if (timeoutMs === null) {
          if (!acted)
            throw new Error('The DJ ran out of time before answering.')

          history.remember(channelId, userId, exchange)

          return MESSAGES.djActed
        }

        // Tools off for the closing call, so the answer cannot carry more
        // dangling tool calls and the conversation stays safe to remember.
        // Endpoints that emit tool calls even when none were offered get
        // sanitized away here.
        typing()

        const reply = await deps.model.complete({
          instructions: instructions(),
          messages: [...exchange],
          timeoutMs,
          sessionId: channelId,
        })

        history.remember(channelId, userId, [...exchange, { role: 'assistant', content: reply.text ?? '' }])

        return clampMessage(reply.text) ?? (acted ? MESSAGES.djActed : null)
      }
      catch (error) {
        if (!acted)
          throw error

        deps.logger.error('dj.failed_after_acting', error)
        history.remember(channelId, userId, exchange)

        return MESSAGES.djActed
      }
    },
  }
}
