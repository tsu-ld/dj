import type { Clock } from '../core/clock.ts'
import type { ChatMessage } from '../ports/conversation.ts'
import { ttlMap } from '../core/ttl-map.ts'
import { HISTORY_IDLE_MS, HISTORY_MAX_MESSAGES } from '../limits.ts'

const MAX_CONVERSATIONS = 1_000

export function conversationKey(channelId: string, userId: string | null): string {
  return userId !== null ? `${channelId}:${userId}` : channelId
}

// The endpoint rejects a tool result not preceded by the assistant message
// carrying its tool call, so the cut starts at a request.
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
}

export function conversationHistory(options: { clock: Clock }): ConversationHistory {
  const entries = ttlMap<string, readonly ChatMessage[]>({
    ttlMs: HISTORY_IDLE_MS,
    max: MAX_CONVERSATIONS,
    now: () => options.clock.now(),
  })

  return {
    recall(channelId, userId) {
      return entries.get(conversationKey(channelId, userId)) ?? []
    },
    remember(channelId, userId, messages) {
      entries.set(conversationKey(channelId, userId), trimToWholeExchanges(messages))
    },
  }
}
