import type { QueueView } from '../../ports/music.ts'
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { log, track, view } from '../../commands/tests/fakes.ts'
import { NOW_PLAYING_REPOST_MS } from '../../limits.ts'
import { messageSlot } from '../slot.ts'
import { fakeChannel } from './fakes.ts'

const GUILD = '123456789012345678'

// Writes are serialized through promises, so a fake timer tick still needs a
// few microtask turns before the card is on the fake channel.
async function settle(): Promise<void> {
  for (let index = 0; index < 40; index++)
    await Promise.resolve()
}

function queueOf(count: number): QueueView {
  return view({
    current: track({ title: 'Song 1' }),
    upcoming: Array.from({ length: count - 1 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` })),
    size: count,
  })
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('messageSlot', () => {
  test('trackStarted sends the now-playing card once', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.payload.embeds[0]?.toJSON().title).toBe('Song 1')

    slot.dispose()
  })

  test('stateChanged edits the card in place', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    slot.stateChanged({ guildId: GUILD, view: view({ paused: true, size: 2 }), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.edits).toHaveLength(1)
    expect(channel.sent[0]?.edits[0]?.embeds[0]?.toJSON().fields?.find(field => field.name === 'Status')?.value).toBe('Paused')

    slot.dispose()
  })

  test('a card in another channel is replaced in the new channel', async () => {
    const first = fakeChannel('2', GUILD)
    const second = fakeChannel('3', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: first.channel })
    await settle()
    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: second.channel })
    await settle()

    expect(first.sent).toHaveLength(1)
    expect(second.sent).toHaveLength(1)

    slot.stateChanged({ guildId: GUILD, view: view({ paused: true, size: 2 }), textChannel: second.channel })
    await settle()

    expect(second.sent[0]?.edits).toHaveLength(1)
    expect(first.sent[0]?.edits).toHaveLength(0)

    slot.dispose()
  })

  test('a failed edit sends a fresh card instead of dying', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    const card = channel.sent[0]

    if (!card)
      throw new Error('missing card')

    card.message.edit = async () => {
      throw new Error('gone')
    }

    slot.stateChanged({ guildId: GUILD, view: view({ paused: true, size: 2 }), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(2)

    slot.dispose()
  })

  test('a repost deletes the old card and sends it again after the debounce', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    const first = channel.sent[0]

    slot.repost({ guildId: GUILD, view: view({ current: track({ title: 'Next' }), size: 2 }), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)

    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(first?.deletions()).toBe(1)
    expect(channel.sent).toHaveLength(2)
    expect(channel.sent[1]?.payload.embeds[0]?.toJSON().title).toBe('Next')

    slot.dispose()
  })

  test('two reposts inside the window produce one write', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    jest.advanceTimersByTime(500)
    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS - 1)
    await settle()

    expect(channel.sent).toHaveLength(1)

    jest.advanceTimersByTime(1)
    await settle()

    expect(channel.sent).toHaveLength(2)

    slot.dispose()
  })

  test('a repost from another channel is ignored', async () => {
    const channel = fakeChannel('2', GUILD)
    const other = fakeChannel('3', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()
    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: other.channel })
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.deletions()).toBe(0)

    slot.dispose()
  })

  test('a repost without a tracked card does nothing', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(channel.sent).toHaveLength(0)

    slot.dispose()
  })

  test('showQueue replaces the previous queue card', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    await slot.showQueue(queueOf(2), channel.channel)

    const first = channel.sent[0]

    await slot.showQueue(queueOf(3), channel.channel)

    expect(first?.deletions()).toBe(1)
    expect(channel.sent).toHaveLength(2)
    expect(channel.sent[1]?.payload.embeds[0]?.toJSON().title).toBe('Queue (3 songs)')

    slot.dispose()
  })

  test('playlistQueued posts the queue card', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.playlistQueued({ guildId: GUILD, view: queueOf(4), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.payload.embeds[0]?.toJSON().title).toBe('Queue (4 songs)')

    slot.dispose()
  })

  test('showing the queue keeps the now-playing card last', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()
    await slot.showQueue(view({ size: 2 }), channel.channel)

    const card = channel.sent[0]

    expect(channel.sent).toHaveLength(2)

    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(card?.deletions()).toBe(1)
    expect(channel.sent).toHaveLength(3)

    slot.dispose()
  })

  test('showing the queue without a card does not invent one', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    await slot.showQueue(queueOf(2), channel.channel)
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(channel.sent).toHaveLength(1)

    slot.dispose()
  })

  test('queueCleared deletes both cards and cancels a pending repost', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()
    await slot.showQueue(view({ size: 2 }), channel.channel)

    const card = channel.sent[0]
    const queueCard = channel.sent[1]

    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    slot.queueCleared({ guildId: GUILD })
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(card?.deletions()).toBe(1)
    expect(queueCard?.deletions()).toBe(1)
    expect(channel.sent).toHaveLength(2)

    slot.dispose()
  })

  test('dispose clears the repost timer', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    await settle()

    slot.repost({ guildId: GUILD, view: view({ size: 2 }), textChannel: channel.channel })
    slot.dispose()
    jest.advanceTimersByTime(NOW_PLAYING_REPOST_MS)
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.deletions()).toBe(0)
  })

  test('a payload without a text channel is ignored', async () => {
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: null })
    await settle()

    slot.dispose()
  })
})
