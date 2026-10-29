export interface TtlMap<K, V> {
  get: (key: K) => V | undefined
  set: (key: K, value: V) => void
  delete: (key: K) => void
  clear: () => void
  size: () => number
}

interface Entry<V> {
  value: V
  expiresAt: number
}

// Ephemeral per-guild and per-user state must not grow forever. One owner for
// the TTL and the cap keeps conversations, cooldowns and prepared clips honest.
export function ttlMap<K, V>(options: { ttlMs: number, max: number, now?: () => number }): TtlMap<K, V> {
  const now = options.now ?? (() => Date.now())
  const entries = new Map<K, Entry<V>>()

  function prune(at: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= at)
        entries.delete(key)
    }

    while (entries.size > options.max) {
      const oldest = entries.keys().next()

      if (oldest.done)
        return

      entries.delete(oldest.value)
    }
  }

  return {
    get(key) {
      const entry = entries.get(key)

      if (!entry)
        return undefined

      if (entry.expiresAt <= now()) {
        entries.delete(key)

        return undefined
      }

      return entry.value
    },
    set(key, value) {
      const at = now()

      entries.delete(key)
      entries.set(key, { value, expiresAt: at + options.ttlMs })
      prune(at)
    },
    delete(key) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
    size() {
      prune(now())

      return entries.size
    },
  }
}
