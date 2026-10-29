import { ttlMap } from './ttl-map.ts'

export interface Cooldown {
  has: (key: string) => boolean
  take: (key: string) => boolean
  mark: (key: string) => void
}

// A request that arrives inside the window is refused; the window is capped so
// a busy server cannot grow the map forever.
export function cooldown(ms: number, options: { maxEntries?: number, now?: () => number } = {}): Cooldown {
  const entries = ttlMap<string, true>({ ttlMs: ms, max: options.maxEntries ?? 1000, now: options.now })

  return {
    has: key => entries.get(key) === true,
    take(key) {
      if (entries.get(key) === true)
        return false

      entries.set(key, true)

      return true
    },
    mark(key) {
      entries.set(key, true)
    },
  }
}
