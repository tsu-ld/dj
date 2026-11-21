import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandOutcome } from '../../commands/spec.ts'
import type { JsonRecord } from '../../core/json.ts'
import type { CompletionReply, ToolCall } from '../../ports/conversation.ts'

interface TestMessage {
  message: Message
  replies: Array<string>
}

export function testMessage(channel: GuildTextBasedChannel): TestMessage {
  const replies: Array<string> = []
  const message = {
    channelId: channel.id,
    channel,
    author: { id: 'user-1' },
    async reply(content: string) {
      replies.push(content)

      return null
    },
  } as unknown as Message

  return { message, replies }
}

interface TestBus extends CommandBus {
  calls: Array<{ name: string; args: JsonRecord }>
}

export function testBus(
  run?: (
    name: string,
    args: JsonRecord,
    context: CommandContext,
  ) => CommandOutcome | Promise<CommandOutcome>,
): TestBus {
  const calls: Array<{ name: string; args: JsonRecord }> = []

  const bus: TestBus = {
    specs: [],
    tools: [
      { name: 'skip', description: 'Skip the current song.', parameters: { type: 'object' } },
    ],
    routes: [],
    calls,
    async run(name, args, context) {
      calls.push({ name, args })

      return run ? run(name, args, context) : { kind: 'ok', data: {} }
    },
    async runTool(name, args, context) {
      return bus.run(name, args, context)
    },
  }

  return bus
}

export function ok(data: JsonRecord = {}): CommandOutcome {
  return { kind: 'ok', data }
}

export function refused(message: string): CommandOutcome {
  return { kind: 'refused', message }
}

export function failed(error: unknown): CommandOutcome {
  return { kind: 'failed', error }
}

export function toolReply(...calls: ReadonlyArray<ToolCall>): CompletionReply {
  return { text: null, toolCalls: calls }
}

export function call(id: string, name: string, args = '{}'): ToolCall {
  return { id, name, arguments: args }
}
