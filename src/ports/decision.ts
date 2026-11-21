import type { JsonRecord } from '../core/json.ts'

export interface DecisionOption {
  readonly name: string
  readonly description: string
}

export interface DecisionInput {
  readonly text: string
  readonly state: JsonRecord
  readonly options: ReadonlyArray<DecisionOption>
  readonly sessionId: string
}

export interface DecisionPort {
  choose: (input: DecisionInput) => Promise<string | null>
}
