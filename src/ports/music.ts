import type { GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js'

export interface Track {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly durationSeconds: number
  readonly isLive: boolean
  readonly thumbnail: string | null
  readonly requestedBy: string | null
  readonly fromRadio: boolean
}

export interface QueueView {
  readonly current: Track | null
  readonly upcoming: readonly Track[]
  readonly paused: boolean
  readonly radio: boolean
  readonly size: number
}

export interface PlayRequest {
  readonly kind: 'text' | 'tracks'
  readonly value: string | readonly string[]
  readonly member: GuildMember
  readonly voiceChannel: VoiceBasedChannel
  readonly textChannel: GuildTextBasedChannel
  // A batch requested by the dj must not announce each song: the dj already
  // answered. A direct request does announce.
  readonly announce: boolean
}

export interface PlayResult {
  readonly added: number
  readonly first: string | null
  readonly playlist: { readonly name: string, readonly count: number } | null
  readonly dropped: number
  readonly total: number
}

export interface BeforeStreamInput {
  readonly guildId: string
  readonly track: Track
  readonly view: QueueView
}

export interface MusicEventMap {
  trackQueued: { guildId: string, track: Track, view: QueueView, textChannel: GuildTextBasedChannel | null, announce: boolean }
  playlistQueued: { guildId: string, name: string, count: number, view: QueueView, textChannel: GuildTextBasedChannel | null, announce: boolean }
  trackStarted: { guildId: string, track: Track, view: QueueView, textChannel: GuildTextBasedChannel | null }
  stateChanged: { guildId: string, view: QueueView, textChannel: GuildTextBasedChannel | null }
  queueEnded: { guildId: string }
  queueCleared: { guildId: string, resetStation: boolean }
  playbackError: { guildId: string, error: unknown, textChannel: GuildTextBasedChannel | null, cleanupAfterError: boolean }
  disconnected: { guildId: string }
}

export interface PlaybackStatus {
  readonly state: 'idle' | 'playing' | 'paused'
  readonly playbackDurationMs: number
}

export interface AudioOverMusic {
  playClip: (guildId: string, filePath: string) => Promise<boolean>
  playWelcome: (channel: VoiceBasedChannel) => Promise<void>
}

export interface MusicPort {
  play: (request: PlayRequest) => Promise<PlayResult>
  pause: (guildId: string) => Promise<void>
  resume: (guildId: string) => Promise<void>
  toggle: (guildId: string) => Promise<boolean>
  skip: (guildId: string) => Promise<void>
  stop: (guildId: string, options?: { resetStation?: boolean }) => Promise<void>
  shuffle: (guildId: string) => Promise<void>
  remove: (guildId: string, position: number) => Promise<string>
  radio: (guildId: string, on?: boolean) => Promise<boolean>
  view: (guildId: string) => QueueView | null
  status: (guildId: string) => PlaybackStatus | null
  readonly audio: AudioOverMusic
  on: <K extends keyof MusicEventMap>(event: K, listener: (payload: MusicEventMap[K]) => void) => () => void
  dispose: () => Promise<void>
}
