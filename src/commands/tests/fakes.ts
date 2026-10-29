import type { GuildMember, GuildTextBasedChannel, Message, VoiceBasedChannel } from 'discord.js'
import type { Logger } from '../../core/logger.ts'
import type { MusicPort, QueueView, Track } from '../../ports/music.ts'
import type { GuildSettings, SettingsPort } from '../../ports/settings.ts'
import type { CommandContext, CommandServices, CommandUi } from '../spec.ts'
import { logger } from '../../core/logger.ts'

export const log: Logger = logger({ level: 'error', sink: () => {} })

export function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Song 1',
    url: 'https://youtu.be/1',
    durationSeconds: 180,
    isLive: false,
    thumbnail: null,
    requestedBy: 'tsu',
    fromRadio: false,
    ...overrides,
  }
}

export function view(overrides: Partial<QueueView> = {}): QueueView {
  return {
    current: overrides.current === undefined ? track() : overrides.current,
    upcoming: [],
    paused: false,
    radio: false,
    size: 1,
    ...overrides,
  }
}

export function fakeVoice(id = 'voice-1'): VoiceBasedChannel {
  return { id } as unknown as VoiceBasedChannel
}

export function fakeMember(options: { allowed?: boolean, voiceChannel?: VoiceBasedChannel | null } = {}): GuildMember {
  return {
    permissions: { has: () => options.allowed ?? true },
    voice: { channel: options.voiceChannel ?? null },
  } as unknown as GuildMember
}

export function fakeTextChannel(id = '2'): GuildTextBasedChannel {
  return { id, isTextBased: () => true } as unknown as GuildTextBasedChannel
}

export interface MusicRecorder extends MusicPort {
  readonly calls: string[]
}

export function fakeMusic(overrides: Partial<MusicPort> = {}): MusicRecorder {
  const calls: string[] = []

  const music: MusicPort = {
    async play() {
      calls.push('play')

      return { added: 0, first: null, dropped: 0 }
    },
    async pause() {
      calls.push('pause')
    },
    async resume() {
      calls.push('resume')
    },
    async toggle() {
      calls.push('toggle')

      return true
    },
    async skip() {
      calls.push('skip')
    },
    async stop() {
      calls.push('stop')
    },
    async shuffle() {
      calls.push('shuffle')
    },
    async remove() {
      calls.push('remove')

      return ''
    },
    async radio() {
      calls.push('radio')

      return true
    },
    view() {
      return null
    },
    status: () => null,
    audio: {
      async playClip() {
        return false
      },
      async playWelcome() {},
    },
    on() {
      return () => {}
    },
    async dispose() {},
  }

  return { ...music, calls, ...overrides }
}

export interface SettingsRecorder extends SettingsPort {
  readonly updates: [string, Partial<GuildSettings>][]
}

export function fakeSettings(initial: GuildSettings = { textChannelId: null, persona: null }): SettingsRecorder {
  const updates: [string, Partial<GuildSettings>][] = []
  let current = initial

  return {
    updates,
    get: () => current,
    async update(guildId, patch) {
      updates.push([guildId, patch])
      current = { ...current, ...patch }
    },
    async flush() {},
  }
}

export interface UiRecorder extends CommandUi {
  readonly replies: string[]
  readonly errors: string[]
  readonly acks: () => number
  readonly queues: QueueView[]
}

export function fakeUi(): UiRecorder {
  const replies: string[] = []
  const errors: string[] = []
  const queues: QueueView[] = []
  let acks = 0

  return {
    replies,
    errors,
    queues,
    acks: () => acks,
    async reply(text) {
      replies.push(text)
    },
    async error(message) {
      errors.push(message)
    },
    async ack() {
      acks++
    },
    async showQueue(queueView) {
      queues.push(queueView)
    },
  }
}

export interface ContextOptions {
  guildId?: string
  member?: GuildMember
  voiceChannel?: VoiceBasedChannel | null
  textChannel?: GuildTextBasedChannel
  message?: Message | null
  settings?: GuildSettings
  queue?: QueueView | null
  services?: Partial<CommandServices>
  ui?: CommandUi
}

export function fakeContext(options: ContextOptions = {}): CommandContext {
  return {
    guildId: options.guildId ?? '123456789012345678',
    member: options.member ?? fakeMember(),
    voiceChannel: options.voiceChannel === undefined ? fakeVoice() : options.voiceChannel,
    textChannel: options.textChannel ?? fakeTextChannel(),
    message: options.message ?? null,
    settings: options.settings ?? { textChannelId: null, persona: null },
    queue: options.queue ?? null,
    services: { music: fakeMusic(), settings: fakeSettings(), logger: log, ...options.services },
    ui: options.ui ?? fakeUi(),
  }
}

export interface MessageOptions {
  content?: string
  channels?: readonly { readonly id: string, readonly name?: string }[]
  fetchChannel?: (id: string) => unknown
  me?: unknown
}

export function fakeMessage(options: MessageOptions = {}): Message {
  const channels = options.channels ?? []
  const value = {
    content: options.content ?? '',
    mentions: {
      channels: new Map(channels.map(channel => [channel.id, channel])),
      users: new Map(),
    },
    guild: {
      members: { me: options.me ?? {} },
      channels: {
        async fetch(id: string) {
          if (options.fetchChannel)
            return options.fetchChannel(id)

          return channels.find(channel => channel.id === id) ?? null
        },
      },
    },
  }

  return value as unknown as Message
}
