import type { ChatMessage } from '../../ports/conversation.ts'
import { describe, expect, test } from 'bun:test'
import { HISTORY_MAX_MESSAGES } from '../../limits.ts'
import { testClock } from '../../tests/fixtures.ts'
import { conversationHistory } from '../history.ts'

function exchange(number: number): Array<ChatMessage> {
  return [
    { role: 'user', content: `pedido ${number}` },
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: `call-${number}`, name: 'add_songs', arguments: '{}' }],
    },
    { role: 'tool', toolCallId: `call-${number}`, content: '{"queued":1}' },
    { role: 'assistant', content: `listo ${number}` },
  ]
}

function hasOrphanToolResult(messages: ReadonlyArray<ChatMessage>): boolean {
  const announcedCallIds = new Set<string>()

  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      announcedCallIds.add(toolCall.id)
    }

    if (
      message.role === 'tool' &&
      message.toolCallId !== undefined &&
      !announcedCallIds.has(message.toolCallId)
    ) {
      return true
    }
  }

  return false
}

function rememberedAfter(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ChatMessage> {
  const history = conversationHistory({ clock: testClock() })

  history.remember('channel-trim', 'user-a', messages)

  return history.recall('channel-trim', 'user-a')
}

describe('a remembered conversation is trimmed to whole exchanges', () => {
  test('a conversation under the cap is kept whole', () => {
    const messages = [...exchange(1), ...exchange(2)]

    expect(rememberedAfter(messages)).toEqual(messages)
  })

  test('trimming never leaves a tool result without its call', () => {
    const messages: Array<ChatMessage> = [
      ...exchange(1),
      ...exchange(2),
      ...exchange(3),
      ...exchange(4),
      { role: 'user', content: 'pedido 5' },
      { role: 'assistant', content: 'listo 5' },
    ]

    expect(hasOrphanToolResult(messages.slice(-HISTORY_MAX_MESSAGES))).toBe(true)
    expect(hasOrphanToolResult(rememberedAfter(messages))).toBe(false)
  })

  test('a trimmed conversation starts at a request', () => {
    const messages = [
      ...exchange(1),
      ...exchange(2),
      ...exchange(3),
      ...exchange(4),
      ...exchange(5),
    ]
    const trimmed = rememberedAfter(messages)

    expect(trimmed[0]?.role).toBe('user')
    expect(trimmed).toHaveLength(HISTORY_MAX_MESSAGES)
  })

  test('the most recent exchange always survives', () => {
    const messages = [
      ...exchange(1),
      ...exchange(2),
      ...exchange(3),
      ...exchange(4),
      ...exchange(5),
    ]
    const trimmed = rememberedAfter(messages)

    expect(trimmed.at(-1)).toEqual({ role: 'assistant', content: 'listo 5' })
  })

  test('leftovers with no request at all are dropped', () => {
    const messages: Array<ChatMessage> = [
      { role: 'tool', toolCallId: 'call-1', content: '{}' },
      { role: 'assistant', content: 'listo' },
    ]

    expect(rememberedAfter(messages)).toEqual([])
  })
})

describe('conversationHistory', () => {
  test('two users in one channel do not share context', () => {
    const history = conversationHistory({ clock: testClock() })

    history.remember('channel-shared', 'user-a', exchange(1))

    expect(history.recall('channel-shared', 'user-b')).toEqual([])
    expect(history.recall('channel-shared', 'user-a')).toEqual(exchange(1))
  })

  test('the same user keeps context across requests', () => {
    const history = conversationHistory({ clock: testClock() })

    history.remember('channel-same', 'user-a', exchange(1))
    history.remember('channel-same', 'user-a', [...exchange(1), ...exchange(2)])

    expect(history.recall('channel-same', 'user-a').at(-1)).toEqual({
      role: 'assistant',
      content: 'listo 2',
    })
  })

  test('without an author the conversation falls back to the channel', () => {
    const history = conversationHistory({ clock: testClock() })

    history.remember('channel-fallback', null, exchange(1))

    expect(history.recall('channel-fallback', null)).toEqual(exchange(1))
  })

  test('an idle conversation expires', () => {
    const clock = testClock()
    const history = conversationHistory({ clock })

    history.remember('channel-ttl', 'user-a', exchange(1))
    clock.advance(600_001)

    expect(history.recall('channel-ttl', 'user-a')).toEqual([])
  })

  test('a conversation that was just used is still there', () => {
    const clock = testClock()
    const history = conversationHistory({ clock })

    history.remember('channel-live', 'user-a', exchange(1))
    clock.advance(599_999)

    expect(history.recall('channel-live', 'user-a')).toEqual(exchange(1))
  })

  test('the number of conversations is capped', () => {
    const history = conversationHistory({ clock: testClock() })

    for (let channel = 0; channel <= 1000; channel++) {
      history.remember(`channel-${channel}`, 'user-a', exchange(channel))
    }

    expect(history.recall('channel-0', 'user-a')).toEqual([])
    expect(history.recall('channel-1', 'user-a')).toEqual(exchange(1))
    expect(history.recall('channel-1000', 'user-a')).toEqual(exchange(1000))
  })
})
