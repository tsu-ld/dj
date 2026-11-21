import type { Message } from 'discord.js'
import type { GuildSettings } from './settings.ts'

export interface RepliesPort {
  say: (message: Message, settings: GuildSettings, text: string) => Promise<void>
}
