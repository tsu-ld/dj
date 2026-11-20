import type { GuildMember, GuildTextBasedChannel, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandOutcome } from '../../commands/spec.ts'
import type { Logger } from '../../core/logger.ts'
import type { CompletionReply, CompletionRequest, ConversationPort, ToolCall } from '../../ports/conversation.ts'
import type { MusicPort } from '../../ports/music.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { logger } from '../../core/logger.ts'
import { silentLog } from '../../tests/fixtures.ts'

export { silentLog, testClock, testTrack, testView } from '../../tests/fixtures.ts'
export type { TestClock } from '../../tests/fixtures.ts'

export interface CapturedLog {
  events: string[]
  logger: Logger
}

export function captureLogger(): CapturedLog {
  const events: string[] = []
  const log = logger({
    level: 'debug',
    sink(line) {
      const parsed = parseJson(line)

      if (isRecord(parsed) && typeof parsed.event === 'string')
        events.push(parsed.event)
    },
  })

  return { events, logger: log }
}

export interface TestChannel {
  channel: GuildTextBasedChannel
  sent: string[]
  typing: { count: number }
}

export function testChannel(options: { id?: string, failSend?: boolean, failTyping?: boolean } = {}): TestChannel {
  const sent: string[] = []
  const typing = { count: 0 }
  const channel = {
    id: options.id ?? 'chan-1',
    async send(content: string) {
      if (options.failSend)
        throw new Error('send failed')

      sent.push(content)

      return null
    },
    async sendTyping() {
      typing.count++

      if (options.failTyping)
        throw new Error('typing failed')
    },
  } as unknown as GuildTextBasedChannel

  return { channel, sent, typing }
}

export interface TestMessage {
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

function testMember(): GuildMember {
  return {} as unknown as GuildMember
}

export interface TestSettings extends SettingsPort {
  current: () => GuildSettings
}

export function testSettings(initial: Partial<GuildSettings> = {}): TestSettings {
  let value: GuildSettings = { textChannelId: null, persona: null, ...initial }

  return {
    get: () => ({ ...value }),
    async update(_guildId, patch) {
      value = { ...value, ...patch }
    },
    async flush() {},
    current: () => ({ ...value }),
  }
}

function testMusic(): MusicPort {
  return {
    view: () => null,
    status: () => null,
  } as unknown as MusicPort
}

export interface TestBus extends CommandBus {
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

      return run ? run(name, args, context) : { kind: 'ok', data: undefined }
    },
    async runTool(name, args, context) {
      return bus.run(name, args, context)
    },
  }

  return bus
}

export function ok(data?: Record<string, unknown>): CommandOutcome {
  return { kind: 'ok', data }
}

export function refused(message: string): CommandOutcome {
  return { kind: 'refused', message }
}

export function failed(error: unknown): CommandOutcome {
  return { kind: 'failed', error }
}

export interface TestContextOptions {
  channel?: GuildTextBasedChannel
  message?: Message | null
  music?: MusicPort
}

export function testContext(options: TestContextOptions = {}): CommandContext {
  const channel = options.channel ?? testChannel().channel
  const settingsPort = testSettings()

  return {
    guildId: '123456789012345678',
    member: testMember(),
    voiceChannel: null,
    textChannel: channel,
    message: options.message ?? null,
    settings: settingsPort.get('123456789012345678'),
    queue: null,
    services: {
      music: options.music ?? testMusic(),
      settings: settingsPort,
      logger: silentLog,
    },
    ui: {
      reply: async () => {},
      error: async () => {},
      ack: async () => {},
      showQueue: async () => {},
    },
  }
}

export interface ScriptedModel extends ConversationPort {
  requests: CompletionRequest[]
}

export function scriptedModel(
  steps: ReadonlyArray<(request: CompletionRequest) => CompletionReply | Promise<CompletionReply>>,
): ScriptedModel {
  const requests: CompletionRequest[] = []
  let index = 0

  return {
    requests,
    async complete(request) {
      requests.push(request)

      const step = steps[Math.min(index, steps.length - 1)]

      index++

      if (!step)
        return { text: null, toolCalls: [] }

      return step(request)
    },
  }
}

export function textReply(text: string): CompletionReply {
  return { text, toolCalls: [] }
}

export function toolReply(...calls: readonly ToolCall[]): CompletionReply {
  return { text: null, toolCalls: calls }
}

export function call(id: string, name: string, args = '{}'): ToolCall {
  return { id, name, arguments: args }
}
