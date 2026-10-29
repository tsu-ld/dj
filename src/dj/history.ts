import type { Clock } from '../core/clock.ts'
import type { ChatMessage } from '../ports/conversation.ts'
import { ttlMap } from '../core/ttl-map.ts'
import { HISTORY_IDLE_MS, HISTORY_MAX_MESSAGES } from '../limits.ts'

const MAX_CONVERSATIONS = 1_000

// Keyed by user as well as channel: one person's request must not replay into
// another person's turn and carry an injection along with it.
export function conversationKey(channelId: string, userId: string | null): string {
  return userId !== null && userId !== '' ? `${channelId}:${userId}` : channelId
}

// The endpoint rejects a tool result that is not preceded by the assistant
// message carrying its tool call, so a blind slice can produce a conversation
// the model refuses. Cut forward to the first request instead.
export function trimToWholeExchanges(messages: readonly ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-HISTORY_MAX_MESSAGES)
  const firstRequestIndex = recent.findIndex(message => message.role === 'user')

  if (firstRequestIndex < 0)
    return []

  return recent.slice(firstRequestIndex)
}

export interface ConversationHistory {
  recall: (channelId: string, userId: string | null) => readonly ChatMessage[]
  remember: (channelId: string, userId: string | null, messages: readonly ChatMessage[]) => void
  size: () => number
}

// The history belongs to one dj agent, not to the module: two bots in one
// process must never see each other's conversations.
export function conversationHistory(options: { clock: Clock, maxConversations?: number }): ConversationHistory {
  const entries = ttlMap<string, readonly ChatMessage[]>({
    ttlMs: HISTORY_IDLE_MS,
    max: options.maxConversations ?? MAX_CONVERSATIONS,
    now: () => options.clock.now(),
  })

  return {
    recall(channelId, userId) {
      return entries.get(conversationKey(channelId, userId)) ?? []
    },
    remember(channelId, userId, messages) {
      entries.set(conversationKey(channelId, userId), trimToWholeExchanges(messages))
    },
    size() {
      return entries.size()
    },
  }
}
