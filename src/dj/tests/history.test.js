import { expect, test } from 'bun:test'
import { trimToWholeExchanges } from '../history.js'

function exchange(number) {
  return [
    { role: 'user', content: `pedido ${number}` },
    { role: 'assistant', content: '', tool_calls: [{ id: `call-${number}`, type: 'function', function: { name: 'add_songs', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `call-${number}`, content: '{"queued":1}' },
    { role: 'assistant', content: `listo ${number}` },
  ]
}

// The chat API rejects a tool result whose matching tool_calls never appeared.
function hasOrphanToolResult(messages) {
  const announcedCallIds = new Set()

  for (const message of messages) {
    for (const call of message.tool_calls ?? [])
      announcedCallIds.add(call.id)

    if (message.role === 'tool' && !announcedCallIds.has(message.tool_call_id))
      return true
  }

  return false
}

test('a conversation under the cap is kept whole', () => {
  const messages = [...exchange(1), ...exchange(2)]

  expect(trimToWholeExchanges(messages)).toEqual(messages)
})

test('trimming never leaves a tool result without its call', () => {
  const messages = [
    ...exchange(1),
    ...exchange(2),
    ...exchange(3),
    ...exchange(4),
    { role: 'user', content: 'pedido 5' },
    { role: 'assistant', content: 'listo 5' },
  ]

  expect(hasOrphanToolResult(messages.slice(-16))).toBe(true)
  expect(hasOrphanToolResult(trimToWholeExchanges(messages))).toBe(false)
})

test('a trimmed conversation starts at a request', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3), ...exchange(4), ...exchange(5)]
  const trimmed = trimToWholeExchanges(messages)

  expect(trimmed[0].role).toBe('user')
  expect(trimmed.length).toBeLessThanOrEqual(16)
})

test('the most recent exchange always survives', () => {
  const messages = [...exchange(1), ...exchange(2), ...exchange(3), ...exchange(4), ...exchange(5)]
  const trimmed = trimToWholeExchanges(messages)

  expect(trimmed.at(-1)).toEqual({ role: 'assistant', content: 'listo 5' })
})

test('leftovers with no request at all are dropped', () => {
  const messages = [
    { role: 'tool', tool_call_id: 'call-1', content: '{}' },
    { role: 'assistant', content: 'listo' },
  ]

  expect(trimToWholeExchanges(messages)).toEqual([])
})
