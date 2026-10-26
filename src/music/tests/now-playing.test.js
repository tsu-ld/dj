import { expect, test } from 'bun:test'
import { nowPlayingEmbed, nowPlayingRows, queueView } from '../now-playing.js'
import { shouldCleanupAfterError } from '../queue-events.js'

function song(name, extra = {}) {
  return { name, ...extra }
}

function queueOf(count) {
  return {
    songs: Array.from({ length: count }, (_, index) => song(`Song ${index + 1}`, {
      formattedDuration: '3:00',
      member: { displayName: 'tsu' },
    })),
    paused: false,
    autoplay: false,
  }
}

function statusOf(embed) {
  return embed.toJSON().fields?.find(field => field.name === 'Status')?.value
}

test('the first queue page lists ten songs and disables previous', () => {
  const { embed, row } = queueView(queueOf(15), 1)
  const data = embed.toJSON()

  expect(data.description.split('\n')).toHaveLength(10)
  expect(data.description.split('\n')[0]).toBe('1. Song 1')
  expect(data.footer.text).toBe('Page 1 of 2')

  const [previous, next] = row.toJSON().components

  expect(previous.disabled).toBe(true)
  expect(next.disabled).toBe(false)
})

test('the second queue page lists the rest and disables next', () => {
  const { embed, row } = queueView(queueOf(15), 2)
  const lines = embed.toJSON().description.split('\n')

  expect(lines).toHaveLength(5)
  expect(lines[0]).toBe('11. Song 11')

  const [previous, next] = row.toJSON().components

  expect(previous.disabled).toBe(false)
  expect(next.disabled).toBe(true)
})

test('out-of-range pages are clamped to the real pages', () => {
  expect(queueView(queueOf(15), 0).embed.toJSON().footer.text).toBe('Page 1 of 2')
  expect(queueView(queueOf(15), 99).embed.toJSON().footer.text).toBe('Page 2 of 2')
})

test('an empty queue is one empty page', () => {
  const { embed, row } = queueView(queueOf(0), 1)
  const data = embed.toJSON()

  expect(data.title).toBe('Queue (0 songs)')
  expect(data.description).toBe('Empty')
  expect(data.footer.text).toBe('Page 1 of 1')

  for (const button of row.toJSON().components)
    expect(button.disabled).toBe(true)
})

test('the card shows the paused state', () => {
  const queue = queueOf(2)

  expect(statusOf(nowPlayingEmbed(queue, queue.songs[0]))).toBe('Playing')

  queue.paused = true

  expect(statusOf(nowPlayingEmbed(queue, queue.songs[0]))).toBe('Paused')
})

test('the toggle button names the action it triggers', () => {
  const queue = queueOf(2)
  const toggleLabel = () => nowPlayingRows(queue)[0].toJSON().components[0].label

  expect(toggleLabel()).toBe('Pause')

  queue.paused = true

  expect(toggleLabel()).toBe('Resume')
})

test('a song without a duration gets a safe placeholder', () => {
  const queue = queueOf(1)
  const embed = nowPlayingEmbed(queue, song('odd'))

  expect(embed.toJSON().fields.find(field => field.name === 'Duration').value).toBe('Unknown')
  expect(embed.toJSON().fields.find(field => field.name === 'Duration').value.length).toBeGreaterThan(0)
})

test('a live song is labelled live', () => {
  const queue = queueOf(1)

  expect(nowPlayingEmbed(queue, song('stream', { isLive: true })).toJSON().fields[0].value).toBe('Live')
})

test('cleanup only runs when the failed song left the live queue empty', () => {
  const queue = { songs: [] }

  expect(shouldCleanupAfterError(queue, queue)).toBe(true)
  expect(shouldCleanupAfterError({ songs: [song('next')] }, queue)).toBe(false)
  expect(shouldCleanupAfterError(queue, { songs: [] })).toBe(false)
  expect(shouldCleanupAfterError(queue, undefined)).toBe(false)
})
