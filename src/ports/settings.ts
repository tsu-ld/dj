export interface GuildSettings {
  readonly textChannelId: string | null
  readonly persona: string | null
}

export interface SettingsPort {
  get: (guildId: string) => GuildSettings
  update: (guildId: string, patch: Partial<GuildSettings>) => Promise<void>
  flush: () => Promise<void>
}
