import { expect, test } from 'bun:test'
import { isPositionInQueue, removeSongAt, skipSong } from '../queue-controls.js'

test('queue positions are one-based and bounded by the queue', () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }] }

  expect(isPositionInQueue(queue, 1)).toBe(true)
  expect(isPositionInQueue(queue, 2)).toBe(true)
  expect(isPositionInQueue(queue, 0)).toBe(false)
  expect(isPositionInQueue(queue, 3)).toBe(false)
})

test('removing a song keeps the rest of the queue in order', async () => {
  const queue = { songs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }

  await removeSongAt(queue, 2)

  expect(queue.songs.map(song => song.name)).toEqual(['a', 'c'])
})

test('removing the current song skips it instead of splicing', async () => {
  let skipped = false
  const queue = {
    songs: [{ name: 'a' }, { name: 'b' }],
    autoplay: false,
    skip: async () => {
      skipped = true
    },
  }

  await removeSongAt(queue, 1)

  expect(skipped).toBe(true)
})

test('skipping the last song clears the queue instead of sitting on it', async () => {
  let stopped = false
  const queue = {
    id: '123456789012345678',
    songs: [{ name: 'a' }],
    autoplay: false,
    stop: async () => {
      stopped = true
    },
  }

  await skipSong(queue)

  expect(stopped).toBe(true)
})
