import { expect, test } from 'bun:test'
import { clampMessage } from '../text.js'

test('a surrogate pair straddling the limit is not split', () => {
  const text = `${'x'.repeat(1999)}🎉`

  expect(clampMessage(text)).toBe('x'.repeat(1999))
})

test('text under the limit passes through untouched', () => {
  expect(clampMessage('a🎉b')).toBe('a🎉b')
})

test('plain text is cut at the discord limit', () => {
  const text = 'a'.repeat(2500)

  expect(clampMessage(text)).toBe('a'.repeat(2000))
})

test('blank content says nothing', () => {
  expect(clampMessage('   ')).toBe(null)
  expect(clampMessage(undefined)).toBe(null)
})
