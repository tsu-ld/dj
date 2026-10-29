import type { GuildMember, GuildTextBasedChannel, Message, VoiceBasedChannel } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import type { ToolSpec } from '../ports/conversation.ts'
import type { DecisionOption } from '../ports/decision.ts'
import type { MusicPort, QueueView } from '../ports/music.ts'
import type { GuildSettings, SettingsPort } from '../ports/settings.ts'

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
  readonly settings: GuildSettings
  readonly queue: QueueView | null
  readonly services: CommandServices
  readonly ui: CommandUi
}

export type CommandData = Record<string, unknown> | undefined

export interface CommandSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly requiresQueue?: boolean
  readonly requiresVoice?: boolean
  readonly modelTool?: boolean
  readonly fastRoute?: boolean
  readonly ack?: boolean
  readonly parse?: (text: string, context: CommandContext) => Record<string, unknown> | null
  readonly authorize?: (context: CommandContext) => void
  readonly run: (args: Record<string, unknown>, context: CommandContext) => Promise<CommandData>
  readonly confirm?: (data: CommandData, context: CommandContext) => string | null
}

export type CommandOutcome
  = | { readonly kind: 'ok', readonly data: CommandData }
    | { readonly kind: 'refused', readonly message: string }
    | { readonly kind: 'failed', readonly error: unknown, readonly message?: string }

export interface CommandBus {
  readonly specs: readonly CommandSpec[]
  readonly tools: readonly ToolSpec[]
  readonly routes: readonly DecisionOption[]
  run: (name: string, args: Record<string, unknown>, context: CommandContext) => Promise<CommandOutcome>
  runTool: (name: string, args: Record<string, unknown>, context: CommandContext) => Promise<CommandOutcome>
}
