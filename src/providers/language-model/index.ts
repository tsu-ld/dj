import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { ChatMessage, CompletionReply, CompletionRequest, ConversationPort, ToolCall, ToolSpec } from '../../ports/conversation.ts'
import { errorMessage, ProviderError } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { endpointHeaders, failedResponse, isRetryableStatus, mapFailure } from '../endpoint.ts'

type LanguageConfig = Extract<AppConfig['language'], { enabled: true }>

const MAX_OUTPUT_PREVIEW = 200
const RETRY_JITTER_MIN_MS = 250
const RETRY_JITTER_MS = 500

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function toInputItems(message: ChatMessage): readonly Record<string, unknown>[] {
  if (message.role === 'tool')
    return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }]

  const items: Record<string, unknown>[] = []

  if (message.content !== null && message.content !== '')
    items.push({ role: message.role, content: message.content })

  for (const call of message.toolCalls ?? []) {
    items.push({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
    })
  }

  return items
}

function toWireTool(tool: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

function buildBody(config: LanguageConfig, request: CompletionRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    store: false,
    instructions: request.instructions,
    max_output_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
    input: request.messages.flatMap(toInputItems),
  }

  if (request.tools) {
    body.tools = request.tools.map(toWireTool)
    body.tool_choice = 'auto'
  }

  if (request.reasoning)
    body.reasoning = { effort: request.reasoning }

  return body
}

async function sendWithRetry(
  send: () => Promise<Response>,
  deadline: number,
  clock: Clock,
  logger: Logger,
): Promise<Response> {
  let failed: { status: number } | { error: string }

  try {
    const response = await send()

    if (!isRetryableStatus(response.status))
      return response

    failed = { status: response.status }
  }
  catch (error) {
    if (isAbortError(error))
      throw error

    failed = { error: errorMessage(error) }
  }

  const remaining = deadline - clock.now()

  if (remaining <= 0)
    throw new Error('LLM request ran out of time')

  logger.warn('language.retry', { ...failed, remaining })

  await new Promise(resolve => setTimeout(
    resolve,
    Math.min(RETRY_JITTER_MIN_MS + Math.random() * RETRY_JITTER_MS, remaining),
  ))

  return send()
}

function toReply(output: readonly unknown[]): CompletionReply {
  const text: string[] = []
  const toolCalls: ToolCall[] = []

  for (const item of output) {
    if (!isRecord(item))
      continue

    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string')
          text.push(part.text)
      }
    }

    if (
      item.type === 'function_call'
      && typeof item.call_id === 'string'
      && typeof item.name === 'string'
      && typeof item.arguments === 'string'
    ) {
      toolCalls.push({ id: item.call_id, name: item.name, arguments: item.arguments })
    }
  }

  return { text: text.join('') || null, toolCalls }
}

export function conversationModel(deps: {
  config: LanguageConfig
  logger: Logger
  clock: Clock
}): ConversationPort {
  const { config, logger, clock } = deps

  return {
    async complete(request) {
      const timeoutMs = Math.min(request.timeoutMs, config.timeoutMs)
      const deadline = clock.now() + timeoutMs
      const body = JSON.stringify(buildBody(config, request))
      const send = async () => fetch(config.baseUrl, {
        method: 'POST',
        headers: endpointHeaders(config.apiKey, request.sessionId),
        body,
        signal: AbortSignal.timeout(Math.max(deadline - clock.now(), 1)),
      })

      let response: Response

      try {
        response = await sendWithRetry(send, deadline, clock, logger)
      }
      catch (error) {
        throw mapFailure(error)
      }

      if (!response.ok)
        throw await failedResponse('LLM endpoint', response)

      let raw: string

      try {
        raw = await response.text()
      }
      catch (error) {
        throw mapFailure(error)
      }

      const payload = parseJson(raw)

      if (!isRecord(payload) || !Array.isArray(payload.output)) {
        throw new ProviderError(
          `LLM endpoint returned no output: ${raw.slice(0, MAX_OUTPUT_PREVIEW)}`,
          { failure: 'fatal', status: response.status },
        )
      }

      return toReply(payload.output)
    },
  }
}
