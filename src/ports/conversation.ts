export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  readonly role: ChatRole
  readonly content: string | null
  readonly toolCalls?: readonly ToolCall[]
  readonly toolCallId?: string
}

export interface CompletionRequest {
  readonly instructions: string
  readonly messages: readonly ChatMessage[]
  readonly tools?: readonly ToolSpec[]
  readonly timeoutMs: number
  readonly maxOutputTokens?: number
  readonly reasoning?: 'none'
  readonly sessionId: string
}

export interface CompletionReply {
  readonly text: string | null
  readonly toolCalls: readonly ToolCall[]
}

export interface ConversationPort {
  complete: (request: CompletionRequest) => Promise<CompletionReply>
}
