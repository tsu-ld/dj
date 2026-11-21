import type { Clock } from './clock.ts'
import { ttlMap } from './ttl-map.ts'

interface Cooldown {
  has: (key: string) => boolean
  take: (key: string) => boolean
  mark: (key: string) => void
}

export function cooldown(ms: number, clock: Clock): Cooldown {
  const entries = ttlMap<string, true>({ ttlMs: ms, max: 1000, clock })

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
