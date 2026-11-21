import { describe, expect, test } from 'bun:test'
import { testClock } from '../../tests/fixtures.ts'
import { circuitBreaker, keyedQueue, withTimeout } from '../async.ts'
import { TimeoutError } from '../errors.ts'

describe('withTimeout', () => {
  test('returns the value when the work finishes in time', async () => {
    expect(await withTimeout(Promise.resolve(7), 100)).toBe(7)
  })

  test('rejects with a TimeoutError when the work hangs', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toBeInstanceOf(TimeoutError)
  })
})

describe('keyedQueue', () => {
  test('serializes work for one key and runs different keys in parallel', async () => {
    const queue = keyedQueue()
    const order: Array<string> = []

    const first = queue.run('a', async () => {
      order.push('a1-start')
      await Bun.sleep(10)
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
  test('opens on a failure and allows one trial after the cooldown', () => {
    const clock = testClock(0)
    const breaker = circuitBreaker({ cooldownMs: 100, clock })

    expect(breaker.allow()).toBe(true)
    breaker.failure()
    expect(breaker.allow()).toBe(false)

    clock.advance(101)

    expect(breaker.allow()).toBe(true)
    expect(breaker.allow()).toBe(false)

    breaker.success()
    expect(breaker.allow()).toBe(true)
  })
})
