import { expect, test } from 'bun:test'
import { songToAnnounce } from '../queue-events.js'

test('the line belongs to the song on the card, not to the youtube search behind it', () => {
  const spotify = { id: 'sp', stream: { playFromSource: false } }
  const youtube = { id: 'yt', stream: { playFromSource: true } }
  const queue = { songs: [spotify] }

  expect(songToAnnounce(youtube, queue)).toBe(spotify)
  expect(songToAnnounce(spotify, queue)).toBe(spotify)
})

test('a stream resolved for any other song stays silent', () => {
  const other = { id: 'other', stream: { playFromSource: true } }
  const queue = { songs: [{ id: 'current', stream: { playFromSource: true } }] }

  expect(songToAnnounce(other, queue)).toBeNull()
  expect(songToAnnounce(other, null)).toBeNull()
})
