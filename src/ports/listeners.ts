export interface ListenerProfile {
  readonly name: string
  readonly requests: number
  readonly topSong: { readonly title: string; readonly count: number } | null
  readonly topArtists: ReadonlyArray<string>
}

export interface ListenersPort {
  recordRequest: (
    guildId: string,
    listener: { readonly id: string; readonly name: string },
    song: { readonly title: string; readonly artist: string | null },
  ) => void
  profile: (guildId: string, listenerId: string) => ListenerProfile | null
  flush: () => Promise<void>
}
