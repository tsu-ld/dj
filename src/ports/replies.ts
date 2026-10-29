import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { GuildSettings } from './settings.ts'

// In-character text is a capability of its own: the Discord adapter asks for a
// line and never knows whether a model rewrote it or the plain text was used.
export interface RepliesPort {
  say: (message: Message, settings: GuildSettings, text: string) => Promise<void>
  announce: (channel: GuildTextBasedChannel, settings: GuildSettings, text: string) => Promise<void>
}
