import { Events } from 'discord.js'
import { ActionError } from '../actions/action.js'
import { getAction, routeOptions } from '../actions/index.js'
import { askDj } from '../dj/ask.js'
import { isConfigured } from '../dj/client.js'
import { chooseAction } from '../dj/decide.js'
import { refuse, say } from '../dj/speak.js'
import { MESSAGES } from '../messages/en.js'
import { scheduleNowPlayingRepost } from '../music/now-playing.js'
import { player } from '../music/player.js'
import { client } from './client.js'
import { isChannelConfiguration, readMention } from './mentions.js'
import { chooseRoute } from './route.js'

const DJ_REQUEST_COOLDOWN_MS = 15_000
const PLAIN_QUERY_COOLDOWN_MS = 2_000

const DJ_OPTION = {
  name: 'dj',
  description: 'Everything else: talk to the user, answer questions, or choose and queue music from a song, artist, mood, genre or era.',
}
const DECISION_OPTIONS = [
  ...routeOptions.map(({ name, description }) => ({ name, description })),
  DJ_OPTION,
]

const lastDjRequestAtByChannel = new Map()
const djRequestsInFlightByChannel = new Set()
const lastPlainQueryAtByUser = new Map()

export function setupMessageRouter(store) {
  client.on(Events.MessageCreate, createMessageHandler(store))
}

export function createMessageHandler(store) {
  return async (message) => {
    try {
      if (message.author.bot || !message.guildId || !message.channel.isTextBased())
        return

      const { botMentioned, channelMentions, text } = readMention(message)
      const context = messageContext(message, store)
      const isListeningChannel = message.channelId === context.settings.textChannelId

      if (!botMentioned) {
        if (text && isListeningChannel) {
          if (takePlainQuerySlot(message))
            await runWithFeedback(getAction('query'), { query: text }, context)
          else
            await message.reply(MESSAGES.rateLimited)
        }
      }
      else if (isChannelConfiguration(text, channelMentions)) {
        await runWithFeedback(getAction('set_channel'), { channelId: channelMentions[0].id }, context)
      }
      else if (!isListeningChannel) {
        await message.reply(context.settings.textChannelId ? MESSAGES.wrongChannel(context.settings.textChannelId) : MESSAGES.emptyMention)
      }
      else if (!text) {
        await message.reply(MESSAGES.emptyMention)
      }
      else {
        await handleMention(text, context)
      }
    }
    catch (error) {
      console.error('[Discord] Message handling error:', error)
    }

    // Bot messages return above: rescheduling from our own now-playing repost
    // would keep deleting and resending it forever.
    const queue = player.getQueue(message.guildId)

    if (queue && queue.textChannel?.id === message.channelId)
      scheduleNowPlayingRepost(queue)
  }
}

// Plain messages are cheap to type and expensive to search: one per user per
// couple of seconds stops a burst from spawning parallel YouTube lookups.
function takePlainQuerySlot(message) {
  const key = `${message.guildId}:${message.author.id}`
  const now = Date.now()
  const lastAt = lastPlainQueryAtByUser.get(key) ?? 0

  if (now - lastAt < PLAIN_QUERY_COOLDOWN_MS)
    return false

  lastPlainQueryAtByUser.set(key, now)

  if (lastPlainQueryAtByUser.size > 1000) {
    for (const [entry, at] of lastPlainQueryAtByUser) {
      if (now - at > PLAIN_QUERY_COOLDOWN_MS)
        lastPlainQueryAtByUser.delete(entry)
    }
  }

  return true
}

function messageContext(message, store) {
  return {
    guildId: message.guildId,
    message,
    member: message.member,
    voiceChannel: message.member?.voice?.channel ?? null,
    textChannel: message.channel,
    settings: store.get(message.guildId),
    store,
    queue: player.getQueue(message.guildId),
  }
}

async function handleMention(text, context) {
  const choice = await decide(text, context)

  // Jev can take a few hundred milliseconds; re-read the live queue so a song
  // that ended in the meantime does not leave a stale queue behind.
  context.queue = player.getQueue(context.guildId)

  const route = chooseRoute(text, choice, context)

  // No confident command, or arguments only the dj can infer ("remove the
  // third one"): let the dj act with its tools.
  if (!route) {
    await askDjInChannel(context, text)

    return
  }

  if (route.refusal) {
    await refuse(context.message, context.settings, route.refusal)

    return
  }

  await runWithFeedback(route.action, route.args, context)
}

async function decide(text, context) {
  try {
    return await chooseAction({
      text,
      state: decisionState(context),
      options: DECISION_OPTIONS,
      sessionId: context.message.channelId,
    })
  }
  catch (error) {
    // Jev is a fast path, not a requirement: a bad decision call falls back to
    // the dj's own tool choice.
    console.error('[DJ] Decision failed:', error)

    return null
  }
}

function decisionState({ member, queue }) {
  return {
    author_in_voice: Boolean(member?.voice?.channel),
    queue: queue && {
      playing: queue.songs[0]?.name ?? null,
      paused: queue.paused,
      radio: queue.autoplay,
      size: queue.songs.length,
      upcoming: queue.songs.slice(1, 6).map(song => song.name),
    },
  }
}

async function runWithFeedback(action, args, context) {
  if (!action)
    return

  try {
    const result = await action.run(args, context)

    if (!context.message)
      return

    if (action.confirm)
      await say(context.message, context.settings, action.confirm(result, context))
    else if (action.ack)
      await context.message.react('✅')
  }
  catch (error) {
    if (!(error instanceof ActionError))
      throw error

    if (!context.message)
      return

    if (error.say)
      await say(context.message, context.settings, error.message)
    else
      await refuse(context.message, context.settings, error.message)
  }
}

async function askDjInChannel(context, request) {
  const { message, settings, store, voiceChannel } = context

  // Jev-routed commands and buttons keep their own paths; only the dj's
  // conversational turn needs the LLM.
  if (!isConfigured()) {
    await message.reply(MESSAGES.djUnavailable)

    return
  }

  const isBusy = djRequestsInFlightByChannel.has(message.channelId)
    || Date.now() - (lastDjRequestAtByChannel.get(message.channelId) ?? 0) < DJ_REQUEST_COOLDOWN_MS

  if (isBusy) {
    await message.reply(MESSAGES.djBusy)

    return
  }

  djRequestsInFlightByChannel.add(message.channelId)

  try {
    const reply = await askDj({
      message,
      settings,
      request,
      voiceChannel,
      store,
    })

    // A null reply means the model never said anything, which the person would
    // otherwise read as being ignored.
    await (reply ? message.reply(reply) : message.react('❌'))
  }
  catch (error) {
    console.error('[DJ] Request failed:', error)
    await message.reply(MESSAGES.djError).catch(() => {})
  }
  finally {
    djRequestsInFlightByChannel.delete(message.channelId)
    lastDjRequestAtByChannel.set(message.channelId, Date.now())
  }
}
