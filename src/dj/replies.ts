import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { GuildSettings } from '../ports/settings.ts'
import { errorMessage } from '../core/errors.ts'
import { clampMessage } from '../core/text.ts'
import { buildAnnouncementInstructions, personaFor } from './prompts.ts'

const REWRITE_TIMEOUT_MS = 5_000
const REWRITE_MAX_OUTPUT_TOKENS = 200

interface RewriteChannel {
  readonly id: string
  sendTyping: () => Promise<unknown>
}

// Returns null instead of throwing: say and announce fall back to the plain
// text, and nothing here can do anything useful with the error.
async function speakInCharacter(
  model: ConversationPort | null,
  logger: Logger,
  channel: RewriteChannel,
  settings: GuildSettings,
  text: string,
): Promise<string | null> {
  if (model === null)
    return null

  // A failed typing indicator is not worth interrupting the reply over.
  void channel.sendTyping().catch(() => {})

  try {
    const reply = await model.complete({
      instructions: buildAnnouncementInstructions(personaFor(settings)),
      messages: [{ role: 'user', content: text }],
      timeoutMs: REWRITE_TIMEOUT_MS,
      maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
      sessionId: channel.id,
    })

    return clampMessage(reply.text)
  }
  catch (error) {
    logger.warn('dj.rewrite_failed', { error: errorMessage(error) })

    return null
  }
}

export function djReplies(deps: { model: ConversationPort | null, logger: Logger }): RepliesPort {
  return {
    async say(message: Message, settings: GuildSettings, text: string) {
      const channel = message.channel

      if (!('sendTyping' in channel) || typeof channel.sendTyping !== 'function') {
        await message.reply(text)

        return
      }

      const spoken = await speakInCharacter(deps.model, deps.logger, channel, settings, text)

      await message.reply(spoken ?? text)
    },
    async announce(channel: GuildTextBasedChannel, settings: GuildSettings, text: string) {
      const spoken = await speakInCharacter(deps.model, deps.logger, channel, settings, text)

      await channel.send(spoken ?? text).catch(error => deps.logger.error('dj.announce_failed', error))
    },
  }
}
