import { describe, expect, test } from 'bun:test'
import { ttlMap } from '../ttl-map.ts'

describe('ttlMap', () => {
  test('expires entries after the ttl', () => {
    let now = 0
    const map = ttlMap<string, number>({ ttlMs: 100, max: 10, now: () => now })

    map.set('a', 1)
    expect(map.get('a')).toBe(1)

    now = 101

    expect(map.get('a')).toBeUndefined()
    expect(map.size()).toBe(0)
  })

  test('evicts the oldest entry when the cap is reached', () => {
    let now = 0
    const map = ttlMap<string, number>({ ttlMs: 1000, max: 2, now: () => now })

    map.set('a', 1)
    now++
    map.set('b', 2)
    now++
    map.set('c', 3)

    expect(map.get('a')).toBeUndefined()
    expect(map.get('b')).toBe(2)
    expect(map.get('c')).toBe(3)
  })

  test('resets the order when a key is written again', () => {
    let now = 0
    const map = ttlMap<string, number>({ ttlMs: 1000, max: 2, now: () => now })

    map.set('a', 1)
    now++
    map.set('b', 2)
    now++
    map.set('a', 3)
    now++
    map.set('c', 4)

    expect(map.get('a')).toBe(3)
    expect(map.get('b')).toBeUndefined()
    expect(map.get('c')).toBe(4)
  })
})
