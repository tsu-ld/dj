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

export type ChatRole = 'user' | 'assistant' | 'tool'

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
  readonly reasoning?: 'none' | 'low' | 'medium' | 'high'
  readonly sessionId: string
  readonly signal?: AbortSignal
}

export interface CompletionReply {
  readonly text: string | null
  readonly toolCalls: readonly ToolCall[]
}

// The conversation capability speaks a small chat shape. The provider translates
// it to whatever wire format it needs; callers never see that format.
export interface ConversationPort {
  complete: (request: CompletionRequest) => Promise<CompletionReply>
}
