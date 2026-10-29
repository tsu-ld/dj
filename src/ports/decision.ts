export interface DecisionOption {
  readonly name: string
  readonly description: string
}

export interface DecisionInput {
  readonly text: string
  readonly state: Record<string, unknown>
  readonly options: readonly DecisionOption[]
  readonly sessionId: string
}

// A fast typed classification. Null means "no confident choice", never an
// error: the conversational path is always the fallback.
export interface DecisionPort {
  choose: (input: DecisionInput) => Promise<string | null>
}
