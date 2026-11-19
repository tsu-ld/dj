export interface SongNews {
  readonly title: string
  readonly source: string | null
  readonly publishedAt: number
}

// Facts the on-air host may state about a song. Every field is checked against
// a source, so the host can speak them as facts instead of guesses.
export interface SongFacts {
  readonly artist: string
  readonly title: string
  readonly album: string | null
  readonly year: number | null
  readonly releaseDate: string | null
  readonly genre: string | null
  readonly artistSummary: string | null
  readonly songSummary: string | null
  readonly news: readonly SongNews[]
}

export interface SongFactsPort {
  // The artist is optional: a video title usually carries it, a bare track name
  // does not. An unverifiable artist can only answer null.
  lookup: (input: { title: string, artist: string | null }) => Promise<SongFacts | null>
  // synchronous cache read for a line written live: never fetches
  cached: (input: { title: string, artist: string | null }) => SongFacts | null
}
