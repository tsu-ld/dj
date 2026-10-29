import type { VoiceBasedChannel } from 'discord.js'
import type { AudioOverMusic } from '../../ports/music.ts'

// The SDK's players and connections declare their emitters as methods: turning
// them into function properties makes their parameters contravariant and rejects
// the real objects at the seam.
/* eslint-disable ts/method-signature-style */
export interface AudioPlayerLike {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: unknown[]) => void): unknown
  once(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
  play(resource: unknown): unknown
  stop(force?: boolean): unknown
  pause(): unknown
}

export interface VoiceConnectionLike {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: unknown[]) => void): unknown
  once(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
  subscribe(player: AudioPlayerLike): unknown
}
/* eslint-enable ts/method-signature-style */

export interface VoiceSession {
  readonly connection: VoiceConnectionLike
  readonly audioPlayer: AudioPlayerLike
}

export interface VoiceAccess {
  readonly voice: (guildId: string) => VoiceSession | null
  readonly queue: (guildId: string) => { readonly songs: readonly unknown[], readonly paused: boolean } | null
  readonly join: (channel: VoiceBasedChannel) => Promise<VoiceSession>
}

export interface MusicAudio extends AudioOverMusic {
  readonly playWelcome: (channel: VoiceBasedChannel) => Promise<void>
  readonly dispose: () => Promise<void>
}
