import type { GuildMember, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandUi } from '../commands/spec.ts'
import type { Clock } from '../core/clock.ts'
import type { Logger } from '../core/logger.ts'
import type { DecisionOption, DecisionPort } from '../ports/decision.ts'
import type { MusicPort } from '../ports/music.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { GuildSettings, SettingsPort } from '../ports/settings.ts'
import type { MessageSlot } from './slot.ts'
import { chooseRoute } from '../commands/route.ts'
import { cooldown } from '../core/cooldown.ts'
import { errorMessage } from '../core/errors.ts'
import { UPCOMING_PREVIEW } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { isChannelConfiguration, readMention } from './mentions.ts'

export interface DjAgent {
  ask: (input: { request: string, context: CommandContext, onRefused?: () => void }) => Promise<string | null>
}

interface MessageHandlerDeps {
  readonly bus: CommandBus
  readonly music: MusicPort
  readonly settings: SettingsPort
  readonly replies: RepliesPort
  readonly slot: MessageSlot
  readonly decision: DecisionPort
  readonly agent: DjAgent | null
  readonly logger: Logger
  readonly clock: Clock
  readonly cooldowns: { readonly plainRequestMs: number, readonly djRequestMs: number }
}

const QUERY_OPTION: DecisionOption = {
  name: 'query',
  description: 'Play the message as a song search, an artist, a genre name, or a YouTube/Spotify link. Use it when the user names something to play. Examples: cumbia, rock nacional, lofi beats, jazz, a song title, a band or a link.',
}

const DJ_OPTION: DecisionOption = {
  name: 'dj',
  description: 'Everything else: talk to the user, answer questions, or choose and queue music from a song, artist, mood, genre or era. Users say: poneme algo tranqui, poneme algo para cocinar, recomendame una banda, play something chill.',
}

export function messageHandler(deps: MessageHandlerDeps): (message: Message) => Promise<void> {
  const plainRequests = cooldown(deps.cooldowns.plainRequestMs, deps.clock)
  const djRequests = cooldown(deps.cooldowns.djRequestMs, deps.clock)
  const djInFlight = new Set<string>()

  const inVoice = (guildId: string): boolean => deps.music.status(guildId) !== null

  async function ack(message: Message): Promise<void> {
    await message.react('✅')
  }

  function uiFor(message: Message<true>, settings: GuildSettings): CommandUi {
    return {
      reply: async text => inVoice(message.guildId) ? ack(message) : deps.replies.say(message, settings, text),
      error: async text => deps.replies.say(message, settings, text),
      ack: async () => ack(message),
      showQueue: async view => deps.slot.showQueue(view, message.channel),
    }
  }

  function contextFor(message: Message<true>, member: GuildMember, settings: GuildSettings): CommandContext {
    return {
      guildId: message.guildId,
      member,
      voiceChannel: member.voice.channel,
      textChannel: message.channel,
      message,
      services: { music: deps.music, settings: deps.settings, logger: deps.logger },
      ui: uiFor(message, settings),
    }
  }

  async function decide(
    text: string,
    context: CommandContext,
    options: readonly DecisionOption[],
  ): Promise<string | null> {
    try {
      return await deps.decision.choose({
        text,
        state: decisionState(context),
        options,
        sessionId: context.textChannel.id,
      })
    }
    catch (error) {
      deps.logger.error('discord.decision_failed', error)

      return null
    }
  }

  async function askDj(message: Message<true>, text: string, context: CommandContext): Promise<void> {
    const agent = deps.agent

    if (!agent) {
      await message.reply(MESSAGES.djUnavailable)

      return
    }

    const channelId = message.channelId

    if (djInFlight.has(channelId) || djRequests.has(channelId)) {
      await message.reply(MESSAGES.djBusy)

      return
    }

    djInFlight.add(channelId)

    try {
      let refused = false
      const reply = await agent.ask({
        request: text,
        context,
        onRefused: () => {
          refused = true
        },
      })

      if (reply === null)
        await message.reply(MESSAGES.djNoAnswer)
      else if (inVoice(message.guildId) && !refused)
        await ack(message).catch(error => deps.logger.warn('discord.reaction_failed', { error: errorMessage(error) }))
      else
        await message.reply(reply)
    }
    catch (error) {
      deps.logger.error('discord.dj_failed', error)
      await message.reply(MESSAGES.djError).catch(replyError => deps.logger.warn('discord.reply_failed', { error: errorMessage(replyError) }))
    }
    finally {
      djInFlight.delete(channelId)
      djRequests.mark(channelId)
    }
  }

  async function runRoute(text: string, choice: string | null, context: CommandContext, fallback: () => Promise<void>): Promise<void> {
    const route = chooseRoute(deps.bus, text, choice, context)

    if (route)
      await deps.bus.run(route.spec.name, route.args, context)
    else
      await fallback()
  }

  async function handleMention(message: Message<true>, member: GuildMember, settings: GuildSettings, text: string): Promise<void> {
    const choice = await decide(text, contextFor(message, member, settings), [...deps.bus.routes, DJ_OPTION])
    const context = contextFor(message, member, settings)

    await runRoute(text, choice, context, async () => askDj(message, text, context))
  }

  async function handlePlain(message: Message<true>, member: GuildMember, settings: GuildSettings, text: string): Promise<void> {
    const choice = await decide(text, contextFor(message, member, settings), [...deps.bus.routes, QUERY_OPTION, DJ_OPTION])
    const context = contextFor(message, member, settings)
    const play = async (): Promise<void> => {
      await deps.bus.run('query', { query: text }, context)
    }

    if (choice === null || choice === 'query')
      await play()
    else
      await runRoute(text, choice, context, deps.agent ? async () => askDj(message, text, context) : play)
  }

  return async (message) => {
    if (message.author.bot || !message.inGuild())
      return

    try {
      const member = message.member

      if (!member) {
        await message.reply(MESSAGES.genericError)

        return
      }

      const settings = deps.settings.get(message.guildId)
      const mention = readMention(message)
      const listening = message.channelId === settings.textChannelId

      if (!mention.botMentioned) {
        if (mention.text && listening) {
          const key = `${message.guildId}:${message.author.id}`

          if (plainRequests.take(key))
            await handlePlain(message, member, settings, mention.text)
          else
            await message.reply(MESSAGES.rateLimited)
        }
      }
      else if (isChannelConfiguration(mention.text, mention.channelMentions)) {
        await deps.bus.run('set_channel', {}, contextFor(message, member, settings))
      }
      else if (!listening) {
        await message.reply(settings.textChannelId !== null && settings.textChannelId !== '' ? MESSAGES.wrongChannel(settings.textChannelId) : MESSAGES.emptyMention)
      }
      else if (!mention.text) {
        await message.reply(MESSAGES.emptyMention)
      }
      else {
        await handleMention(message, member, settings, mention.text)
      }
    }
    catch (error) {
      deps.logger.error('discord.message_failed', error)
      await message.reply(MESSAGES.genericError).catch(replyError => deps.logger.warn('discord.reply_failed', { error: errorMessage(replyError) }))
    }

    const view = deps.music.view(message.guildId)

    if (view)
      deps.slot.repost({ guildId: message.guildId, view, textChannel: message.channel })
  }
}

function decisionState(context: CommandContext): Record<string, unknown> {
  const queue = context.services.music.view(context.guildId)

  return {
    author_in_voice: context.voiceChannel !== null,
    queue: queue
      ? {
          playing: queue.current?.title ?? null,
          paused: queue.paused,
          radio: queue.radio,
          size: queue.size,
          upcoming: queue.upcoming.slice(0, UPCOMING_PREVIEW).map(track => track.title),
        }
      : null,
  }
}
