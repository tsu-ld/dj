import type { GuildMember, GuildTextBasedChannel, Message, VoiceBasedChannel } from 'discord.js'
import type { JsonRecord } from '../core/json.ts'
import type { Logger } from '../core/logger.ts'
import type { ToolSpec } from '../ports/conversation.ts'
import type { DecisionOption } from '../ports/decision.ts'
import type { MusicPort, QueueView } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'

export interface CommandUi {
  reply: (text: string) => Promise<void>
  error: (message: string) => Promise<void>
  ack: () => Promise<void>
  showQueue: (view: QueueView) => Promise<void>
}

export interface CommandServices {
  readonly music: MusicPort
  readonly settings: SettingsPort
  readonly logger: Logger
}

export interface CommandContext {
  readonly guildId: string
  readonly member: GuildMember
  readonly voiceChannel: VoiceBasedChannel | null
  readonly textChannel: GuildTextBasedChannel
  readonly message: Message | null
  readonly services: CommandServices
  readonly ui: CommandUi
}

export type CommandData = JsonRecord

export interface QueueContext extends CommandContext {
  readonly queue: QueueView
}

export interface VoiceContext extends CommandContext {
  readonly voiceChannel: VoiceBasedChannel
}

interface SpecBase<Context extends CommandContext> {
  readonly name: string
  readonly description: string
  readonly parameters?: JsonRecord
  readonly modelTool?: boolean
  readonly fastRoute?: boolean
  readonly ack?: boolean
  readonly parse?: (text: string, context: CommandContext) => JsonRecord | null
  readonly authorize?: (context: CommandContext) => void
  readonly run: (args: JsonRecord, context: Context) => Promise<CommandData>
  readonly confirm?: (data: CommandData, context: CommandContext) => string | null
}

interface PlainSpec extends SpecBase<CommandContext> {
  readonly requiresQueue?: false
  readonly requiresVoice?: false
}

export interface QueueSpec extends SpecBase<QueueContext> {
  readonly requiresQueue: true
  readonly requiresVoice?: false
}

export interface VoiceSpec extends SpecBase<VoiceContext> {
  readonly requiresQueue?: false
  readonly requiresVoice: true
}

export type CommandSpec = PlainSpec | QueueSpec | VoiceSpec

export type CommandOutcome =
  | { readonly kind: 'ok'; readonly data: CommandData }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'failed'; readonly error: unknown; readonly message?: string }

export interface CommandBus {
  readonly specs: ReadonlyArray<CommandSpec>
  readonly tools: ReadonlyArray<ToolSpec>
  readonly routes: ReadonlyArray<DecisionOption>
  run: (name: string, args: JsonRecord, context: CommandContext) => Promise<CommandOutcome>
  runTool: (name: string, args: JsonRecord, context: CommandContext) => Promise<CommandOutcome>
}
