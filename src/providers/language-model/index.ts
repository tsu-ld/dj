import type { AppConfig } from '../../config.ts'
import type { Logger } from '../../core/logger.ts'
import type { ConversationPort } from '../../ports/conversation.ts'
import { ProviderError } from '../../core/errors.ts'
import { completeConversation } from './request.ts'

export function conversationModel(deps: {
  config: AppConfig['language']
  logger: Logger
}): ConversationPort {
  const { config, logger } = deps

  if (!config.enabled) {
    return {
      complete: async () => Promise.reject(new ProviderError('language', 'not configured', { failure: 'fatal' })),
    }
  }

  return {
    complete: async request => completeConversation({ config, logger, request }),
  }
}
