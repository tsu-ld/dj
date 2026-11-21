import type { Message, SendableChannels } from 'discord.js'
import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { ConversationPort } from '../ports/conversation.ts'
import type { MusicEventMap } from '../ports/music.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { GuildSettings, SettingsPort } from '../ports/settings.ts'
import { cooldown } from '../core/cooldown.ts'
import { errorMessage } from '../core/errors.ts'
import { clampMessage } from '../core/text.ts'
import { ERROR_ANNOUNCE_MS } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { buildAnnouncementInstructions, personaFor } from './prompts.ts'

const REWRITE_TIMEOUT_MS = 5_000
const REWRITE_MAX_OUTPUT_TOKENS = 200

interface DjReplies extends RepliesPort {
  playbackError: (payload: MusicEventMap['playbackError']) => void
}

async function speakInCharacter(
  model: ConversationPort | null,
  logger: Logger,
  channel: SendableChannels,
  settings: GuildSettings,
  text: string,
): Promise<string | null> {
  if (model === null)
    return null

  void channel.sendTyping().catch(error => logger.debug('dj.typing_failed', { error: errorMessage(error) }))

  try {
    const reply = await model.complete({
      instructions: buildAnnouncementInstructions(personaFor(settings)),
      messages: [{ role: 'user', content: text }],
      timeoutMs: REWRITE_TIMEOUT_MS,
      maxOutputTokens: REWRITE_MAX_OUTPUT_TOKENS,
      reasoning: 'none',
      sessionId: channel.id,
    })

    return clampMessage(reply.text)
  }
  catch (error) {
    logger.warn('dj.rewrite_failed', { error: errorMessage(error) })

    return null
  }
}

export function djReplies(deps: {
  model: ConversationPort | null
  logger: Logger
  settings: SettingsPort
  clock: Clock
}): DjReplies {
  const errorWindow = cooldown(ERROR_ANNOUNCE_MS, deps.clock)

  async function announce(channel: SendableChannels, settings: GuildSettings, text: string): Promise<void> {
    const spoken = await speakInCharacter(deps.model, deps.logger, channel, settings, text)

    await channel.send(spoken ?? text).catch(error => deps.logger.error('dj.announce_failed', error))
  }

  return {
    async say(message: Message, settings: GuildSettings, text: string) {
      const channel = message.channel

      if (!('sendTyping' in channel)) {
        await message.reply(text)

        return
      }

      const spoken = await speakInCharacter(deps.model, deps.logger, channel, settings, text)

      await message.reply(spoken ?? text)
    },
    playbackError(payload) {
      if (!errorWindow.take(payload.guildId) || !payload.textChannel)
        return

      void announce(payload.textChannel, deps.settings.get(payload.guildId), MESSAGES.playbackError)
    },
  }
}
