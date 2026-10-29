import type { GuildMember, GuildTextBasedChannel, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandOutcome } from '../../commands/spec.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { CompletionReply, CompletionRequest, ConversationPort, ToolCall, ToolSpec } from '../../ports/conversation.ts'
import type { MusicPort, QueueView, Track } from '../../ports/music.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { logger } from '../../core/logger.ts'

export interface TestClock extends Clock {
  advance: (milliseconds: number) => void
  set: (milliseconds: number) => void
}

export function testClock(start = 1_000_000): TestClock {
  let current = start

  return {
    now: () => current,
    sleep: async (milliseconds) => {
      current += milliseconds
    },
    advance(milliseconds) {
      current += milliseconds
    },
    set(milliseconds) {
      current = milliseconds
    },
  }
}

export function silentLogger(): Logger {
  return logger({ level: 'error', sink: () => {} })
}

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

export function testMessage(channel: GuildTextBasedChannel, authorId = 'user-1'): TestMessage {
  const replies: string[] = []
  const message = {
    channelId: channel.id,
    channel,
    author: { id: authorId },
    async reply(content: string) {
      replies.push(content)

      return null
    },
  } as unknown as Message

  return { message, replies }
}

export function testMember(): GuildMember {
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

export function testMusic(view: QueueView | null = null): MusicPort {
  return {
    view: () => view,
  } as unknown as MusicPort
}

export function testTrack(title: string, overrides: Partial<Track> = {}): Track {
  return {
    id: title,
    title,
    url: 'https://example.com/watch',
    durationSeconds: 180,
    isLive: false,
    thumbnail: null,
    requestedBy: null,
    fromRadio: false,
    ...overrides,
  }
}

export function testView(overrides: Partial<QueueView> = {}): QueueView {
  return {
    current: testTrack('Tema'),
    upcoming: [],
    paused: false,
    radio: false,
    size: 1,
    ...overrides,
  }
}

export interface TestBus extends CommandBus {
  calls: { name: string, args: Record<string, unknown> }[]
}

export function testBus(
  run?: (name: string, args: Record<string, unknown>, context: CommandContext) => CommandOutcome | Promise<CommandOutcome>,
  tools: readonly ToolSpec[] = [{ name: 'skip', description: 'Skip the current song.', parameters: { type: 'object' } }],
): TestBus {
  const calls: { name: string, args: Record<string, unknown> }[] = []

  const bus: TestBus = {
    specs: [],
    tools,
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
  settings?: GuildSettings
  settingsPort?: SettingsPort
  view?: QueueView | null
  music?: MusicPort
  logger?: Logger
}

export function testContext(options: TestContextOptions = {}): CommandContext {
  const channel = options.channel ?? testChannel().channel
  const settingsPort = options.settingsPort ?? testSettings(options.settings)

  return {
    guildId: '123456789012345678',
    member: testMember(),
    voiceChannel: null,
    textChannel: channel,
    message: options.message ?? null,
    settings: options.settings ?? settingsPort.get('123456789012345678'),
    queue: options.view ?? null,
    services: {
      music: options.music ?? testMusic(options.view ?? null),
      settings: settingsPort,
      logger: options.logger ?? silentLogger(),
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
