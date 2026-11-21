import { describe, expect, test } from 'bun:test'
import { testClock } from '../../tests/fixtures.ts'
import { ttlMap } from '../ttl-map.ts'

describe('ttlMap', () => {
  test('expires entries after the ttl', () => {
    const clock = testClock(0)
    const map = ttlMap<string, number>({ ttlMs: 100, max: 10, clock })

    map.set('a', 1)
    expect(map.get('a')).toBe(1)

    clock.advance(101)

    expect(map.get('a')).toBeUndefined()
  })

  test('evicts the oldest entry when the cap is reached', () => {
    const clock = testClock(0)
    const map = ttlMap<string, number>({ ttlMs: 1000, max: 2, clock })

    map.set('a', 1)
    clock.advance(1)
    map.set('b', 2)
    clock.advance(1)
    map.set('c', 3)

    expect(map.get('a')).toBeUndefined()
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
  })

  test('resets the order when a key is written again', () => {
    const clock = testClock(0)
    const map = ttlMap<string, number>({ ttlMs: 1000, max: 2, clock })

    map.set('a', 1)
    clock.advance(1)
    map.set('b', 2)
    clock.advance(1)
    map.set('a', 3)
    clock.advance(1)
    map.set('c', 4)

    expect(map.get('a')).toBe(3)
    expect(map.get('b')).toBeUndefined()
    expect(map.get('c')).toBe(4)
  })
})
