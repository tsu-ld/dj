import type { Clock } from '../core/clock.ts'
import type { ChatMessage } from '../ports/conversation.ts'
import { ttlMap } from '../core/ttl-map.ts'
import { HISTORY_IDLE_MS, HISTORY_MAX_MESSAGES } from '../limits.ts'

const MAX_CONVERSATIONS = 1000

function conversationKey(channelId: string, userId: string | null): string {
  return userId !== null ? `${channelId}:${userId}` : channelId
}

function trimToStartAtARequest(messages: ReadonlyArray<ChatMessage>): Array<ChatMessage> {
  const recent = messages.slice(-HISTORY_MAX_MESSAGES)
  const firstRequestIndex = recent.findIndex((message) => message.role === 'user')

  if (firstRequestIndex < 0) {
    return []
  }

  return recent.slice(firstRequestIndex)
}

interface ConversationHistory {
  recall: (channelId: string, userId: string | null) => ReadonlyArray<ChatMessage>
  remember: (channelId: string, userId: string | null, messages: ReadonlyArray<ChatMessage>) => void
}

export function conversationHistory(options: { clock: Clock }): ConversationHistory {
  const entries = ttlMap<string, ReadonlyArray<ChatMessage>>({
    ttlMs: HISTORY_IDLE_MS,
    max: MAX_CONVERSATIONS,
    clock: options.clock,
  })

  return {
    recall(channelId, userId) {
      return entries.get(conversationKey(channelId, userId)) ?? []
    },
    remember(channelId, userId, messages) {
      entries.set(conversationKey(channelId, userId), trimToStartAtARequest(messages))
    },
  }
}
