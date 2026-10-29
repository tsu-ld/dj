export interface SpeechPort {
  // A configured provider can still run out of quota or reject a line: false
  // here only means "do not try again until restart".
  readonly available: boolean
  // Returns the path of a rendered clip, or null when the line was skipped.
  // The caller owns the file and deletes it after airing.
  synthesize: (text: string) => Promise<string | null>
  // The caller deletes the clip after airing; this releases the provider's
  // bookkeeping so a long-running process does not remember every line.
  release: (path: string) => void
  dispose: () => Promise<void>
}
