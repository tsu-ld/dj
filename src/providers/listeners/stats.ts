import type { ListenerProfile } from '../../ports/listeners.ts'

export const MAX_SONGS = 50
export const MAX_ARTISTS = 20
export const MAX_MEMBERS = 500
export const WRITE_DELAY_MS = 2_000

export interface SongStat {
  readonly title: string
  readonly count: number
  readonly lastRequested: number
}

export interface ArtistStat {
  readonly count: number
  readonly lastRequested: number
}

export function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function timestampOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

// The key just recorded is pinned: a new key at the cap must be able to earn its
// place instead of losing a stable tie with every existing count-1 entry. Among
// the others, the lowest count goes first, then the least recently requested.
export function keepTop<T extends { readonly count: number, readonly lastRequested: number }>(
  entries: Record<string, T>,
  max: number,
  protectedKey?: string,
): Record<string, T> {
  const keys = Object.keys(entries)

  if (keys.length <= max)
    return entries

  const evictable = keys.filter(key => key !== protectedKey)
  const evicted = new Set(evictable
    .slice()
    .sort((left, right) => {
      const byCount = (entries[left]?.count ?? 0) - (entries[right]?.count ?? 0)

      return byCount !== 0
        ? byCount
        : (entries[left]?.lastRequested ?? 0) - (entries[right]?.lastRequested ?? 0)
    })
    .slice(0, keys.length - max))

  const bounded: Record<string, T> = {}

  for (const key of keys) {
    const entry = entries[key]

    if (!evicted.has(key) && entry)
      bounded[key] = entry
  }

  return bounded
}

export function bumpArtist(artists: Record<string, ArtistStat>, name: string, at: number): Record<string, ArtistStat> {
  const previous = artists[name]
  const next = { ...artists, [name]: { count: (previous?.count ?? 0) + 1, lastRequested: at } }

  return keepTop(next, MAX_ARTISTS, name)
}

export function topSong(songs: Record<string, SongStat>): ListenerProfile['topSong'] {
  let best: SongStat | null = null

  for (const song of Object.values(songs)) {
    if (!best || song.count > best.count || (song.count === best.count && song.lastRequested > best.lastRequested))
      best = song
  }

  return best && best.count >= 2 ? { title: best.title, count: best.count } : null
}

export function topArtists(artists: Record<string, ArtistStat>): readonly string[] {
  return Object.entries(artists)
    .slice()
    .sort((left, right) => right[1].count - left[1].count || right[1].lastRequested - left[1].lastRequested)
    .slice(0, 3)
    .map(([name]) => name)
}
