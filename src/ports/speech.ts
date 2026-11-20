export interface SpeechPort {
  readonly available: boolean
  synthesize: (text: string) => Promise<string | null>
  release: (path: string) => void
  dispose: () => Promise<void>
}
