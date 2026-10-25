import { clampMessage } from '../discord/message-limit.js'
import { MESSAGES } from '../messages/en.js'
import { requestCompletion } from './client.js'
import { recallConversation, rememberConversation } from './history.js'
import { buildDjPrompt } from './persona.js'
import { DJ_TOOLS, runTool } from './tools.js'

const DJ_TIMEOUT_MS = 40_000
// Three rounds to act through the tools, then one forced spoken answer: a
// model that keeps calling tools until the cap would otherwise act in silence.
const MAX_TOOL_ROUNDS = 3

function parseToolArguments(raw) {
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

async function resolveToolCall(call, context) {
  const outcome = async () => {
    const args = parseToolArguments(call.function.arguments)

    if (!args)
      return { error: 'those arguments were not valid JSON' }

    return runTool(call.function.name, args, context)
  }

  try {
    const result = await outcome()

    return { message: { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) }, acted: !result.error }
  }
  catch (error) {
    console.error(`[DJ] Tool "${call.function.name}" failed:`, error)

    return { message: { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: 'the player could not do that' }) }, acted: false }
  }
}

export async function askDj({ message, settings, request, voiceChannel, store }) {
  const context = {
    guildId: message.guildId,
    message,
    settings,
    store,
    voiceChannel,
    textChannel: message.channel,
    member: message.member,
  }
  const exchange = [...recallConversation(message.channelId), { role: 'user', content: request }]
  const conversationWithRules = () => [
    { role: 'system', content: buildDjPrompt(message.guildId, settings) },
    ...exchange,
  ]

  let acted = false

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      void message.channel.sendTyping().catch(() => {})

      const reply = await requestCompletion({
        messages: conversationWithRules(),
        tools: DJ_TOOLS,
        timeoutMs: DJ_TIMEOUT_MS,
        sessionId: message.channelId,
      })

      exchange.push(reply)

      if (!reply.tool_calls?.length) {
        rememberConversation(message.channelId, exchange)

        return clampMessage(reply.content) ?? (acted ? MESSAGES.djActed : null)
      }

      for (const call of reply.tool_calls) {
        const { message: toolMessage, acted: toolActed } = await resolveToolCall(call, context)

        acted ||= toolActed
        exchange.push(toolMessage)
      }
    }

    // Tools off for the closing call, so the answer cannot carry more dangling
    // tool calls and the conversation stays safe to remember. Endpoints that
    // emit tool_calls even when none were offered get sanitized away here.
    void message.channel.sendTyping().catch(() => {})

    const reply = await requestCompletion({
      messages: conversationWithRules(),
      timeoutMs: DJ_TIMEOUT_MS,
      sessionId: message.channelId,
    })

    rememberConversation(message.channelId, [...exchange, { role: 'assistant', content: reply.content ?? '' }])

    return clampMessage(reply.content) ?? (acted ? MESSAGES.djActed : null)
  }
  catch (error) {
    if (!acted)
      throw error

    console.error('[DJ] Request failed after acting:', error)
    rememberConversation(message.channelId, exchange)

    return MESSAGES.djActed
  }
}
