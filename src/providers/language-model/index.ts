import type { AppConfig } from '../../config.ts'
import type { Logger } from '../../core/logger.ts'
import type { ConversationPort } from '../../ports/conversation.ts'
import { completeConversation } from './request.ts'

export function conversationModel(deps: {
  config: Extract<AppConfig['language'], { enabled: true }>
  logger: Logger
}): ConversationPort {
  const { config, logger } = deps

  return {
    complete: async request => completeConversation({ config, logger, request }),
  }
}
