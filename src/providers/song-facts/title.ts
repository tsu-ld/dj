export interface ParsedTitle {
  readonly artist: string | null
  readonly title: string
  readonly explicit: boolean
}

const DECORATION = /\s*[([][^)\]]*\b(?:official\s*(?:music\s*)?video|official\s*audio|audio|lyrics?|remaster(?:ed)?(?:\s+\d{4})?|hd|4k|visuali[sz]er)\b[^)\]]*[)\]]/gi
const CREDIT_BRACKET = /\s*[([][^)\]]*\b(?:ft|feat)\.?\s[^)\]]*[)\]]/gi
const CREDIT_TAIL = /\s(?:ft|feat)\.?\s.*$/i
const SEPARATOR = /\s[-–—]\s/

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function containsWords(text: string, phrase: string): boolean {
  const folded = normalizeName(text)
  const needle = normalizeName(phrase)

  if (folded === '' || needle === '')
    return false

  return ` ${folded} `.includes(` ${needle} `)
}

export function eitherContains(left: string, right: string): boolean {
  return containsWords(left, right) || containsWords(right, left)
}

function stripDecorations(raw: string): string {
  const [head = ''] = raw.split('|')

  return head
    .replace(DECORATION, ' ')
    .replace(CREDIT_BRACKET, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim()
}

export function parseTitle(title: string, artist: string | null): ParsedTitle {
  const cleaned = stripDecorations(title)
  const separator = SEPARATOR.exec(cleaned)
  const trimmedArtist = artist?.trim() ?? ''
  const fallbackArtist = trimmedArtist === '' ? null : trimmedArtist

  if (!separator)
    return { artist: fallbackArtist, title: cleaned, explicit: false }

  const left = cleaned.slice(0, separator.index).trim()
  const right = cleaned.slice(separator.index + separator[0].length).trim()
  const track = stripDecorations(right).replace(CREDIT_TAIL, '').trim()

  if (left === '' || track === '')
    return { artist: fallbackArtist, title: cleaned, explicit: false }

  return { artist: left, title: track, explicit: true }
}

export function cacheKey(parsed: ParsedTitle): string {
  return `${normalizeName(parsed.artist ?? '')}|${normalizeName(parsed.title)}`
}
