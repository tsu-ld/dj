import { ttlMap } from './ttl-map.ts'

export interface Cooldown {
  has: (key: string) => boolean
  take: (key: string) => boolean
  mark: (key: string) => void
}

export function cooldown(ms: number, options: { now?: () => number } = {}): Cooldown {
  const entries = ttlMap<string, true>({ ttlMs: ms, max: 1000, now: options.now })

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
