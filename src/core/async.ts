import { TimeoutError } from './errors.ts'

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), milliseconds)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export interface KeyedQueue {
  run: <T>(key: string, work: () => Promise<T>) => Promise<T>
}

export function keyedQueue(): KeyedQueue {
  const tails = new Map<string, Promise<unknown>>()

  return {
    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const next = previous.catch(() => {}).then(work)

      tails.set(key, next)
      next.then(
        () => {
          if (tails.get(key) === next)
            tails.delete(key)
        },
        () => {
          if (tails.get(key) === next)
            tails.delete(key)
        },
      )

      return next
    },
  }
}

export interface CircuitBreaker {
  allow: () => boolean
  success: () => void
  failure: () => void
}

export function circuitBreaker(options: { cooldownMs: number, now?: () => number }): CircuitBreaker {
  const now = options.now ?? (() => Date.now())
  let openedAt: number | null = null
  let trialInFlight = false

  return {
    allow() {
      if (openedAt === null)
        return true

      if (now() - openedAt < options.cooldownMs)
        return false

      if (trialInFlight)
        return false

      trialInFlight = true

      return true
    },
    success() {
      openedAt = null
      trialInFlight = false
    },
    failure() {
      trialInFlight = false
      openedAt = now()
    },
  }
}
