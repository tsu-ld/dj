import type { GuildMember, GuildTextBasedChannel, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandUi } from '../commands/spec.ts'
import type { Logger } from '../core/logger.ts'
import type { DecisionOption, DecisionPort } from '../ports/decision.ts'
import type { MusicPort } from '../ports/music.ts'
import type { RepliesPort } from '../ports/replies.ts'
import type { GuildSettings, SettingsPort } from '../ports/settings.ts'
import type { MessageSlot } from './slot.ts'
import { chooseRoute } from '../commands/route.ts'
import { cooldown } from '../core/cooldown.ts'
import { UPCOMING_PREVIEW } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { isChannelConfiguration, readMention } from './mentions.ts'

export interface DjAgent {
  ask: (input: { request: string, context: CommandContext }) => Promise<string | null>
}

export interface MessageHandlerDeps {
  readonly bus: CommandBus
  readonly music: MusicPort
  readonly settings: SettingsPort
  readonly replies: RepliesPort
  readonly slot: MessageSlot
  readonly decision: DecisionPort | null
  readonly agent: DjAgent | null
  readonly logger: Logger
  readonly cooldowns: { readonly plainRequestMs: number, readonly djRequestMs: number }
}

const QUERY_OPTION: DecisionOption = {
  name: 'query',
  description: 'Play the message as a song search, an artist, or a YouTube/Spotify link.',
}

const DJ_OPTION: DecisionOption = {
  name: 'dj',
  description: 'Everything else: talk to the user, answer questions, or choose and queue music from a song, artist, mood, genre or era.',
}

export function messageHandler(deps: MessageHandlerDeps): (message: Message) => Promise<void> {
  const plainRequests = cooldown(deps.cooldowns.plainRequestMs)
  const djRequests = cooldown(deps.cooldowns.djRequestMs)
  const djInFlight = new Set<string>()

  function uiFor(message: Message, settings: GuildSettings, channel: GuildTextBasedChannel): CommandUi {
    return {
      reply: async text => deps.replies.say(message, settings, text),
      error: async text => deps.replies.say(message, settings, text),
      ack: async () => {
        await message.react('✅')
      },
      showQueue: async view => deps.slot.showQueue(view, channel),
    }
  }

  function contextFor(message: Message<true>, member: GuildMember, settings: GuildSettings): CommandContext {
    return {
      guildId: message.guildId,
      member,
      voiceChannel: member.voice.channel,
      textChannel: message.channel,
      message,
      settings,
      queue: deps.music.view(message.guildId),
      services: { music: deps.music, settings: deps.settings, logger: deps.logger },
      ui: uiFor(message, settings, message.channel),
    }
  }

  // A mention falls back to the DJ; a plain message falls back to a search.
  // Both use the same deterministic routes, so a confused classifier never
  // blocks a command or a song.
  async function decide(
    text: string,
    context: CommandContext,
    options: readonly DecisionOption[],
  ): Promise<string | null> {
    if (!deps.decision)
      return null

    try {
      return await deps.decision.choose({
        text,
        state: decisionState(context),
        options,
        sessionId: context.textChannel.id,
      })
    }
    catch (error) {
      // The fast router is not a requirement: a bad decision call falls back to
      // the DJ's own tool choice or to the plain search.
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
      const reply = await agent.ask({ request: text, context })

      // A null reply means the model never said anything, which the person
      // would otherwise read as being ignored.
      if (reply !== null)
        await message.reply(reply)
      else
        await message.react('❌')
    }
    catch (error) {
      deps.logger.error('discord.dj_failed', error)
      await message.reply(MESSAGES.djError).catch(() => {})
    }
    finally {
      djInFlight.delete(channelId)
      djRequests.mark(channelId)
    }
  }

  async function playQuery(text: string, context: CommandContext): Promise<void> {
    await deps.bus.run('query', { query: text }, context)
  }

  async function handleMention(message: Message<true>, member: GuildMember, settings: GuildSettings, text: string): Promise<void> {
    const choice = await decide(text, contextFor(message, member, settings), [...deps.bus.routes, DJ_OPTION])

    // The decision can take a few hundred milliseconds; re-read the live queue
    // so a song that ended in the meantime does not leave a stale queue behind.
    const context = contextFor(message, member, settings)
    const route = chooseRoute(deps.bus, text, choice, context)

    if (!route) {
      await askDj(message, text, context)

      return
    }

    if ('refusal' in route) {
      await context.ui.error(route.refusal)

      return
    }

    await deps.bus.run(route.spec.name, route.args, context)
  }

  // A plain message in the listening channel is a request, not necessarily a
  // search: Jev decides between a control, a song and the DJ. No confident
  // choice keeps the old behavior and searches.
  async function handlePlain(message: Message<true>, member: GuildMember, settings: GuildSettings, text: string): Promise<void> {
    const choice = await decide(text, contextFor(message, member, settings), [
      ...deps.bus.routes,
      QUERY_OPTION,
      DJ_OPTION,
    ])

    const context = contextFor(message, member, settings)

    if (choice === null || choice === 'query') {
      await playQuery(text, context)

      return
    }

    if (choice === 'dj') {
      if (!deps.agent) {
        await playQuery(text, context)

        return
      }

      await askDj(message, text, context)

      return
    }

    const route = chooseRoute(deps.bus, text, choice, context)

    if (!route) {
      // A confident route with arguments the text did not carry ("sacá la
      // tercera") is a conversation, not a search.
      if (deps.agent) {
        await askDj(message, text, context)

        return
      }

      await playQuery(text, context)

      return
    }

    if ('refusal' in route) {
      await context.ui.error(route.refusal)

      return
    }

    await deps.bus.run(route.spec.name, route.args, context)
  }

  return async (message) => {
    if (message.author.bot || !message.inGuild())
      return

    if (!message.channel.isTextBased())
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
        const target = mention.channelMentions[0]

        if (target)
          await deps.bus.run('set_channel', { channelId: target.id }, contextFor(message, member, settings))
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
      await message.reply(MESSAGES.genericError).catch(() => {})
    }

    // Bot messages return above: rescheduling from our own now-playing repost
    // would keep deleting and resending it forever.
    const view = deps.music.view(message.guildId)

    if (view)
      deps.slot.repost({ guildId: message.guildId, view, textChannel: message.channel })
  }
}

function decisionState(context: CommandContext): Record<string, unknown> {
  const queue = context.queue

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
