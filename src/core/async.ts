import { TimeoutError } from './errors.ts'

export interface RetryOptions {
  attempts: number
  baseMs: number
  maxMs: number
  jitterMs: number
  sleep: (milliseconds: number) => Promise<void>
  isRetryable: (error: unknown) => boolean
  random?: () => number
  signal?: AbortSignal
}

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), milliseconds)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer)
      clearTimeout(timer)
  })
}

export async function retry<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const random = options.random ?? Math.random

  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()

    try {
      return await run(attempt)
    }
    catch (error) {
      if (attempt >= options.attempts || !options.isRetryable(error))
        throw error

      const exponential = Math.min(options.maxMs, options.baseMs * 2 ** (attempt - 1))
      const delay = exponential + Math.floor(random() * options.jitterMs)

      await options.sleep(delay)
    }
  }
}

export interface SingleFlight {
  run: <T>(key: string, work: () => Promise<T>) => Promise<T>
}

// A burst of the same request (a button pressed twice, two messages in a row)
// must produce one provider call, not two.
export function singleFlight(): SingleFlight {
  const running = new Map<string, Promise<unknown>>()

  return {
    async run<T>(key: string, work: () => Promise<T>): Promise<T> {
      const current = running.get(key) as Promise<T> | undefined

      if (current)
        return current

      const next = work()
      running.set(key, next)

      next.then(
        () => {
          if (running.get(key) === next)
            running.delete(key)
        },
        () => {
          if (running.get(key) === next)
            running.delete(key)
        },
      )

      return next
    },
  }
}

export interface KeyedQueue {
  run: <T>(key: string, work: () => Promise<T>) => Promise<T>
}

// Playback mutations for one guild are serialized: a skip and a remove racing
// each other would otherwise both read the same queue position.
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

// A provider that is down must stop costing a timeout per request. After the
// threshold the breaker opens, and one trial is allowed after the cooldown.
export function circuitBreaker(options: { threshold: number, cooldownMs: number, now?: () => number }): CircuitBreaker {
  const now = options.now ?? (() => Date.now())
  let failures = 0
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
      failures = 0
      openedAt = null
      trialInFlight = false
    },
    failure() {
      failures++
      trialInFlight = false

      if (failures >= options.threshold)
        openedAt = now()
    },
  }
}
