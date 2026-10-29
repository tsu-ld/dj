import { expect, test } from 'bun:test'
import { currentForStream } from '../events.ts'

interface FakeSong {
  id: string
  stream: { playFromSource: boolean }
}

function song(id: string, playFromSource: boolean): FakeSong {
  return { id, stream: { playFromSource } }
}

test('the line belongs to the card, not to the stream resolved behind it', () => {
  const card = song('spotify', false)
  const resolved = song('youtube', true)

  expect(currentForStream(resolved, { songs: [card] })).toBe(card)
  expect(currentForStream(card, { songs: [card] })).toBe(card)
})

test('a stream resolved for another song stays silent', () => {
  const other = song('other', true)
  const current = song('current', true)

  expect(currentForStream(other, { songs: [current] })).toBeNull()
  expect(currentForStream(other, null)).toBeNull()
  expect(currentForStream(other, { songs: [] })).toBeNull()
})
