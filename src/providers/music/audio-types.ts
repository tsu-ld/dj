import type { VoiceBasedChannel } from 'discord.js'
import type { AudioOverMusic } from '../../ports/music.ts'

export interface AudioPlayerLike<Resource = never> {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: Array<unknown>) => void): void
  once(event: string, listener: (...args: Array<unknown>) => void): void
  off(event: string, listener: (...args: Array<unknown>) => void): void
  play(resource: Resource): void
  stop(force?: boolean): void
  pause(): void
}

export interface VoiceConnectionLike {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: Array<unknown>) => void): void
  once(event: string, listener: (...args: Array<unknown>) => void): void
  off(event: string, listener: (...args: Array<unknown>) => void): void
  subscribe(player: AudioPlayerLike<never>): void
}

export interface VoiceSession {
  readonly connection: VoiceConnectionLike
  readonly audioPlayer: AudioPlayerLike
}

export interface VoiceAccess {
  readonly voice: (guildId: string) => VoiceSession | null
  readonly queue: (
    guildId: string,
  ) => { readonly songs: ReadonlyArray<unknown>; readonly paused: boolean } | null
  readonly join: (channel: VoiceBasedChannel) => Promise<VoiceSession>
}

export interface MusicAudio extends AudioOverMusic {
  readonly playWelcome: (channel: VoiceBasedChannel) => Promise<void>
  readonly dispose: () => Promise<void>
}
