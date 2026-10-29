import { describe, expect, test } from 'bun:test'
import { cooldown } from '../cooldown.ts'

describe('cooldown', () => {
  test('a key inside the window is refused until it expires', async () => {
    const window = cooldown(10)

    expect(window.take('user')).toBe(true)
    expect(window.take('user')).toBe(false)

    await Bun.sleep(15)

    expect(window.take('user')).toBe(true)
  })

  test('keys are independent', () => {
    const window = cooldown(10_000)

    expect(window.take('a')).toBe(true)
    expect(window.take('b')).toBe(true)
    expect(window.has('a')).toBe(true)
  })

  test('mark starts the window without taking it', () => {
    const window = cooldown(10_000)

    window.mark('a')

    expect(window.has('a')).toBe(true)
    expect(window.take('a')).toBe(false)
  })

  test('the map is capped by dropping the oldest entry', () => {
    const window = cooldown(10_000, { maxEntries: 2 })

    expect(window.take('a')).toBe(true)
    expect(window.take('b')).toBe(true)
    expect(window.take('c')).toBe(true)
    expect(window.has('a')).toBe(false)
  })
})
