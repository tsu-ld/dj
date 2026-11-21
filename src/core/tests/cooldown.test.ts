import { describe, expect, test } from 'bun:test'
import { testClock } from '../../tests/fixtures.ts'
import { cooldown } from '../cooldown.ts'

describe('cooldown', () => {
  test('a key inside the window is refused until it expires', () => {
    const clock = testClock()
    const window = cooldown(10, clock)

    expect(window.take('user')).toBe(true)
    expect(window.take('user')).toBe(false)

    clock.advance(9)
    expect(window.take('user')).toBe(false)

    clock.advance(1)

    expect(window.take('user')).toBe(true)
  })

  test('keys are independent', () => {
    const window = cooldown(10_000, testClock())

    expect(window.take('a')).toBe(true)
    expect(window.take('b')).toBe(true)
    expect(window.has('a')).toBe(true)
  })

  test('mark starts the window without taking it', () => {
    const window = cooldown(10_000, testClock())

    window.mark('a')

    expect(window.has('a')).toBe(true)
    expect(window.take('a')).toBe(false)
  })
})
