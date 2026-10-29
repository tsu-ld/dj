export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// External JSON is never trusted: parse returns null instead of throwing so the
// caller can decide whether a bad payload is a fallback or a failure.
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]

  return typeof value === 'string' ? value : null
}
