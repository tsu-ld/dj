import { describe, expect, test } from 'bun:test'
import { circuitBreaker, keyedQueue, retry, singleFlight, withTimeout } from '../async.ts'
import { TimeoutError } from '../errors.ts'

describe('withTimeout', () => {
  test('returns the value when the work finishes in time', async () => {
    expect(await withTimeout(Promise.resolve(7), 100)).toBe(7)
  })

  test('rejects with a TimeoutError when the work hangs', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toBeInstanceOf(TimeoutError)
  })
})

describe('retry', () => {
  const base = {
    attempts: 3,
    baseMs: 10,
    maxMs: 100,
    jitterMs: 0,
    random: () => 0,
    sleep: async () => {},
  }

  test('retries a transient failure and returns the success', async () => {
    let calls = 0

    const value = await retry(async () => {
      calls++
      if (calls < 3)
        throw new Error('transient')

      return 'ok'
    }, { ...base, isRetryable: () => true })

    expect(value).toBe('ok')
    expect(calls).toBe(3)
  })

  test('does not retry a permanent failure', async () => {
    let calls = 0

    await expect(retry(async () => {
      calls++
      throw new Error('permanent')
    }, { ...base, isRetryable: () => false })).rejects.toThrow('permanent')
    expect(calls).toBe(1)
  })

  test('stops after the attempt budget', async () => {
    let calls = 0

    await expect(retry(async () => {
      calls++
      throw new Error('still down')
    }, { ...base, isRetryable: () => true })).rejects.toThrow('still down')
    expect(calls).toBe(3)
  })
})

describe('singleFlight', () => {
  test('two calls for the same key share one run', async () => {
    const flight = singleFlight()
    let calls = 0
    let release: (value: string) => void = () => {}
    const work = async () => {
      calls++

      return new Promise<string>((resolve) => {
        release = resolve
      })
    }

    const first = flight.run('a', work)
    const second = flight.run('a', work)

    release('done')

    expect(await Promise.all([first, second])).toEqual(['done', 'done'])
    expect(calls).toBe(1)
  })

  test('a new call after completion runs again', async () => {
    const flight = singleFlight()
    let calls = 0

    await flight.run('a', async () => ++calls)
    await flight.run('a', async () => ++calls)

    expect(calls).toBe(2)
  })
})

describe('keyedQueue', () => {
  test('serializes work for one key and runs different keys in parallel', async () => {
    const queue = keyedQueue()
    const order: string[] = []

    const first = queue.run('a', async () => {
      order.push('a1-start')
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('a1-end')
    })
    const second = queue.run('a', async () => {
      order.push('a2')
    })
    const other = queue.run('b', async () => {
      order.push('b')
    })

    await Promise.all([first, second, other])

    expect(order).toEqual(['a1-start', 'b', 'a1-end', 'a2'])
  })
})

describe('circuitBreaker', () => {
  test('opens after the threshold and allows one trial after the cooldown', () => {
    let now = 0
    const breaker = circuitBreaker({ threshold: 2, cooldownMs: 100, now: () => now })

    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.allow()).toBe(false)

    now = 101

    expect(breaker.allow()).toBe(true)
    expect(breaker.allow()).toBe(false)

    breaker.success()
    expect(breaker.allow()).toBe(true)
  })
})
