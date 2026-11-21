export interface SongNews {
  readonly title: string
  readonly source: string | null
  readonly publishedAt: number
}

export interface SongFacts {
  readonly artist: string
  readonly title: string
  readonly album: string | null
  readonly year: number | null
  readonly releaseDate: string | null
  readonly genre: string | null
  readonly artistSummary: string | null
  readonly songSummary: string | null
  readonly news: ReadonlyArray<SongNews>
}

export interface SongFactsPort {
  lookup: (input: { title: string; artist: string | null }) => Promise<SongFacts | null>
  cached: (input: { title: string; artist: string | null }) => SongFacts | null
}
