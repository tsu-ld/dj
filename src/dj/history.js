// One exchange can be four messages when the DJ uses a tool: the request, the
// tool call, its result, and the spoken reply. Sixteen holds roughly the last
// four exchanges.
const MAX_MESSAGES = 16
const IDLE_TTL_MS = 600_000

const conversations = new Map()

// Keyed by user as well as channel: one person's request must not replay into
// another person's turn and carry an injection along with it.
export function conversationKey(channelId, userId) {
  return userId ? `${channelId}:${userId}` : String(channelId)
}

// The API rejects a `tool` message that is not preceded by the `assistant`
// message carrying its tool_calls, so a blind slice can produce a conversation
// the model refuses. Cut forward to the first request instead.
export function trimToWholeExchanges(messages) {
  const recent = messages.slice(-MAX_MESSAGES)
  const firstRequestIndex = recent.findIndex(message => message.role === 'user')

  if (firstRequestIndex < 0)
    return []

  return recent.slice(firstRequestIndex)
}

export function recallConversation(channelId, userId) {
  const key = conversationKey(channelId, userId)
  const conversation = conversations.get(key)

  if (!conversation)
    return []

  if (Date.now() - conversation.lastSpokeAt > IDLE_TTL_MS) {
    conversations.delete(key)

    return []
  }

  return conversation.messages
}

export function rememberConversation(channelId, userId, messages) {
  conversations.set(conversationKey(channelId, userId), {
    lastSpokeAt: Date.now(),
    messages: trimToWholeExchanges(messages),
  })
}
