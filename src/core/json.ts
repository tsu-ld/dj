export type Json = null | boolean | number | string | ReadonlyArray<Json> | JsonRecord

export interface JsonRecord {
  readonly [key: string]: Json | undefined
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const parseJsonText: (text: string) => Json = JSON.parse

export function parseJson(text: string): Json {
  try {
    return parseJsonText(text)
  } catch {
    return null
  }
}
