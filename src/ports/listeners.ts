export interface ListenerProfile {
  readonly name: string
  readonly requests: number
  readonly topSong: { readonly title: string, readonly count: number } | null
  readonly topArtists: readonly string[]
  readonly skipsGiven: number
  readonly skippedByOthers: number
  readonly firstSeen: number
}

export interface ListenersPort {
  recordRequest: (guildId: string, listener: { readonly id: string, readonly name: string }, song: { readonly title: string, readonly artist: string | null }) => void
  recordSkip: (guildId: string, by: { readonly id: string, readonly name: string }, song: { readonly requesterId: string | null }) => void
  profile: (guildId: string, listenerId: string) => ListenerProfile | null
  flush: () => Promise<void>
}
