import process from 'node:process'

const DEFAULT_MODEL = 'deepseek-v4-flash'

// The endpoint speaks the OpenAI Responses API (/responses): the chat-style
// messages and tools used across the DJ layer are translated here, so the
// provider is only named in this one file.
export async function requestCompletion({ messages, tools, timeoutMs, sessionId }) {
  const endpoint = process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_API_KEY

  if (!endpoint || !apiKey)
    throw new Error('Missing OPENAI_BASE_URL or OPENAI_API_KEY. Set them in the environment.')

  const model = process.env.OPENAI_MODEL ?? DEFAULT_MODEL
  const instructions = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')
  const body = {
    model,
    input: messages.filter(message => message.role !== 'system').flatMap(toResponseItems),
    ...(instructions && { instructions }),
    ...(tools && { tools: tools.map(toResponseTool), tool_choice: 'auto' }),
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'x-opencode-session': sessionId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok)
    throw new Error(`LLM endpoint responded ${response.status}: ${await response.text()}`)

  const payload = await response.json()

  if (!payload.output)
    throw new Error(`LLM endpoint returned no output: ${JSON.stringify(payload).slice(0, 200)}`)

  return toChatMessage(payload.output)
}

function toResponseTool(tool) {
  return {
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }
}

function toResponseItems(message) {
  if (message.role === 'tool')
    return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }]

  const calls = (message.tool_calls ?? []).map(call => ({
    type: 'function_call',
    call_id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }))

  return [...(message.content ? [{ role: message.role, content: message.content }] : []), ...calls]
}

function toChatMessage(output) {
  const content = output
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text)
    .join('')

  const toolCalls = output
    .filter(item => item.type === 'function_call')
    .map(item => ({
      id: item.call_id,
      type: 'function',
      function: { name: item.name, arguments: item.arguments },
    }))

  return {
    role: 'assistant',
    content: content || null,
    ...(toolCalls.length && { tool_calls: toolCalls }),
  }
}
