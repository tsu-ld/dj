import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandOutcome } from '../../commands/spec.ts'
import type { CompletionReply, ToolCall } from '../../ports/conversation.ts'

interface TestMessage {
  message: Message
  replies: string[]
}

export function testMessage(channel: GuildTextBasedChannel): TestMessage {
  const replies: string[] = []
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
  calls: { name: string, args: Record<string, unknown> }[]
}

export function testBus(
  run?: (name: string, args: Record<string, unknown>, context: CommandContext) => CommandOutcome | Promise<CommandOutcome>,
): TestBus {
  const calls: { name: string, args: Record<string, unknown> }[] = []

  const bus: TestBus = {
    specs: [],
    tools: [{ name: 'skip', description: 'Skip the current song.', parameters: { type: 'object' } }],
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

export function ok(data: Record<string, unknown> = {}): CommandOutcome {
  return { kind: 'ok', data }
}

export function refused(message: string): CommandOutcome {
  return { kind: 'refused', message }
}

export function failed(error: unknown): CommandOutcome {
  return { kind: 'failed', error }
}

export function toolReply(...calls: readonly ToolCall[]): CompletionReply {
  return { text: null, toolCalls: calls }
}

export function call(id: string, name: string, args = '{}'): ToolCall {
  return { id, name, arguments: args }
}
