import type { JsonRecord } from '../core/json.ts'

export interface ToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: JsonRecord
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
  readonly toolCalls?: ReadonlyArray<ToolCall>
  readonly toolCallId?: string
}

export interface CompletionRequest {
  readonly instructions: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly tools?: ReadonlyArray<ToolSpec>
  readonly timeoutMs: number
  readonly maxOutputTokens?: number
  readonly reasoning?: 'none'
  readonly sessionId: string
}

export interface CompletionReply {
  readonly text: string | null
  readonly toolCalls: ReadonlyArray<ToolCall>
}

export interface ConversationPort {
  complete: (request: CompletionRequest) => Promise<CompletionReply>
}
