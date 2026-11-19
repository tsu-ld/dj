import type { PlaybackStatus, QueueView } from '../../ports/music.ts'
import type { ViewMessage } from '../views.ts'
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { ComponentType } from 'discord.js'
import { log, track, view } from '../../commands/tests/fakes.ts'
import { NOW_PLAYING_REPOST_MS } from '../../limits.ts'
import { PROGRESS_REPAINT_MS } from '../progress.ts'
import { messageSlot } from '../slot.ts'
import { fakeChannel } from './fakes.ts'

const GUILD = '123456789012345678'

function cardText(payload: ViewMessage | undefined): string {
  const container = payload?.components[0]?.toJSON()

  if (!container)
    return ''

  return container.components.flatMap((component) => {
    if (component.type === ComponentType.TextDisplay)
      return [component.content]

    if (component.type === ComponentType.Section)
      return component.components.map(child => child.content)

    return []
  }).join('\n')
}

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
    expect(cardText(channel.sent[0]?.payload)).toContain('## [Song 1]')

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
    expect(cardText(channel.sent[0]?.edits[0])).toContain('**Paused**')

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
    expect(cardText(channel.sent[1]?.payload)).toContain('## [Next]')

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
    expect(cardText(channel.sent[1]?.payload)).toContain('3 songs')

    slot.dispose()
  })

  test('playlistQueued posts the queue card', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.playlistQueued({ guildId: GUILD, view: queueOf(4), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(cardText(channel.sent[0]?.payload)).toContain('4 songs')

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

describe('messageSlot queue card', () => {
  test('a visible queue card is redrawn in place on every song and state change', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    await slot.showQueue(queueOf(4), channel.channel)

    const queueCard = channel.sent[0]

    slot.trackStarted({ guildId: GUILD, view: queueOf(3), textChannel: channel.channel })
    await settle()
    slot.stateChanged({ guildId: GUILD, view: queueOf(2), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(2)
    expect(queueCard?.deletions()).toBe(0)
    expect(queueCard?.edits).toHaveLength(2)
    expect(cardText(queueCard?.edits[0])).toContain('3 songs')
    expect(cardText(queueCard?.edits[1])).toContain('2 songs')

    slot.dispose()
  })

  test('one queued song redraws a visible queue card and leaves the now-playing card alone', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.queueChanged({ guildId: GUILD, view: queueOf(5), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(0)

    await slot.showQueue(queueOf(3), channel.channel)
    slot.queueChanged({ guildId: GUILD, view: queueOf(4), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(cardText(channel.sent[0]?.edits[0])).toContain('4 songs')

    slot.dispose()
  })

  test('a redrawn queue card goes back to the first page', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    await slot.showQueue(queueOf(15), channel.channel)
    slot.stateChanged({ guildId: GUILD, view: queueOf(14), textChannel: channel.channel })
    await settle()

    expect(cardText(channel.sent[0]?.edits[0])).toContain('14 songs · 42m · Page 1 of 2')

    slot.dispose()
  })

  test('a failed queue card edit forgets the card instead of reposting it', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    await slot.showQueue(queueOf(3), channel.channel)

    const queueCard = channel.sent[0]

    if (!queueCard)
      throw new Error('missing queue card')

    queueCard.message.edit = async () => {
      throw new Error('gone')
    }

    slot.stateChanged({ guildId: GUILD, view: queueOf(2), textChannel: channel.channel })
    await settle()
    slot.stateChanged({ guildId: GUILD, view: queueOf(1), textChannel: channel.channel })
    await settle()

    expect(channel.sent).toHaveLength(2)

    slot.dispose()
  })
})

describe('messageSlot progress', () => {
  function reader(initial: PlaybackStatus): { status: PlaybackStatus, read: (guildId: string) => PlaybackStatus | null } {
    const holder = { status: initial, read: (_guildId: string): PlaybackStatus | null => holder.status }

    return holder
  }

  test('the now-playing card shows the elapsed time and repaints it while playing', async () => {
    const channel = fakeChannel('2', GUILD)
    const playback = reader({ state: 'playing', playbackDurationMs: 65_000 })
    const slot = messageSlot({ logger: log, playback: playback.read })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: channel.channel })
    await settle()

    expect(cardText(channel.sent[0]?.payload)).toContain('1:05 / 3:00')

    playback.status = { state: 'playing', playbackDurationMs: 80_000 }
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS - 1)
    await settle()

    expect(channel.sent[0]?.edits).toHaveLength(0)

    jest.advanceTimersByTime(1)
    await settle()

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0]?.edits).toHaveLength(1)
    expect(cardText(channel.sent[0]?.edits[0])).toContain('1:20 / 3:00')

    slot.dispose()
  })

  test('a paused song is not repainted', async () => {
    const channel = fakeChannel('2', GUILD)
    const playback = reader({ state: 'playing', playbackDurationMs: 10_000 })
    const slot = messageSlot({ logger: log, playback: playback.read })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: channel.channel })
    await settle()
    playback.status = { state: 'paused', playbackDurationMs: 12_000 }
    slot.stateChanged({ guildId: GUILD, view: view({ paused: true, size: 1 }), textChannel: channel.channel })
    await settle()

    expect(cardText(channel.sent[0]?.edits[0])).toContain('0:12 / 3:00')

    jest.advanceTimersByTime(PROGRESS_REPAINT_MS * 3)
    await settle()

    expect(channel.sent[0]?.edits).toHaveLength(1)

    slot.dispose()
  })

  test('a live song has no progress line and no repaint', async () => {
    const channel = fakeChannel('2', GUILD)
    const playback = reader({ state: 'playing', playbackDurationMs: 65_000 })
    const slot = messageSlot({ logger: log, playback: playback.read })

    slot.trackStarted({ guildId: GUILD, view: view({ current: track({ isLive: true }) }), textChannel: channel.channel })
    await settle()
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS * 2)
    await settle()

    expect(cardText(channel.sent[0]?.payload)).not.toContain(' / ')
    expect(channel.sent[0]?.edits).toHaveLength(0)

    slot.dispose()
  })

  test('clearing the queue and disposing stop the repaint', async () => {
    const first = fakeChannel('2', GUILD)
    const other = '223456789012345678'
    const second = fakeChannel('3', other)
    const playback = reader({ state: 'playing', playbackDurationMs: 5_000 })
    const slot = messageSlot({ logger: log, playback: playback.read })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: first.channel })
    slot.trackStarted({ guildId: other, view: view({ size: 1 }), textChannel: second.channel })
    await settle()
    slot.queueCleared({ guildId: GUILD })
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS)
    await settle()

    expect(first.sent[0]?.edits).toHaveLength(0)
    expect(second.sent[0]?.edits).toHaveLength(1)

    slot.dispose()
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS * 2)
    await settle()

    expect(second.sent[0]?.edits).toHaveLength(1)
  })

  test('a song that is still buffering shows 0:00 instead of no progress', async () => {
    const channel = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log, playback: reader({ state: 'idle', playbackDurationMs: 0 }).read })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: channel.channel })
    await settle()

    expect(cardText(channel.sent[0]?.payload)).toContain('0:00 / 3:00')

    slot.dispose()
  })

  test('a repaint never posts a card, even after its edit failed', async () => {
    const home = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log, playback: reader({ state: 'playing', playbackDurationMs: 5_000 }).read })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: home.channel })
    await settle()

    const card = home.sent[0]

    if (!card)
      throw new Error('missing now-playing card')

    jest.advanceTimersByTime(PROGRESS_REPAINT_MS)
    await settle()

    expect(card.edits).toHaveLength(1)

    let attempts = 0
    let failure: Error = new Error('Request timed out')

    card.message.edit = async () => {
      attempts++
      throw failure
    }
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS * 2)
    await settle()

    // a timeout keeps the card: the next tick tries it again
    expect(attempts).toBe(2)

    failure = Object.assign(new Error('Unknown Message'), { code: 10_008 })
    jest.advanceTimersByTime(PROGRESS_REPAINT_MS * 3)
    await settle()

    // a deleted card is forgotten after one more try, and no tick posts a new one
    expect(attempts).toBe(3)
    expect(home.sent).toHaveLength(1)

    slot.dispose()
  })

  test('a card past Discord\'s one-hour edit window is replaced when the next song starts', async () => {
    const home = fakeChannel('2', GUILD)
    const slot = messageSlot({ logger: log })

    slot.trackStarted({ guildId: GUILD, view: view({ size: 2 }), textChannel: home.channel })
    await settle()

    const card = home.sent[0]

    if (!card)
      throw new Error('missing now-playing card')

    Object.assign(card.message, { createdTimestamp: Date.now() - 56 * 60_000 })
    slot.trackStarted({ guildId: GUILD, view: view({ size: 1 }), textChannel: home.channel })
    await settle()

    expect(card.deletions()).toBe(1)
    expect(card.edits).toHaveLength(0)
    expect(home.sent).toHaveLength(2)

    slot.dispose()
  })

  test('the repaint interval respects the edit rate limit', () => {
    expect(PROGRESS_REPAINT_MS).toBeGreaterThanOrEqual(10_000)
  })
})
