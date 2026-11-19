export interface ParsedTitle {
  readonly artist: string | null
  readonly title: string
  // True when the title itself carried "Artist - Track". Only then may the
  // parsed artist be used for facts that Deezer did not confirm.
  readonly explicit: boolean
}

// Uploaders decorate the same song in a dozen ways. Parenthesized or bracketed
// production notes are dropped, but a song whose own name is in brackets (for
// example "Video Games") survives because only the listed phrases match.
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

// Whole words over the folded text: "Air" must not match "Airbourne", nor
// "Sia" "Siamese". Padding the haystack is what makes the boundary real.
export function containsWords(text: string, phrase: string): boolean {
  const folded = normalizeName(text)
  const needle = normalizeName(phrase)

  if (folded === '' || needle === '')
    return false

  return ` ${folded} `.includes(` ${needle} `)
}

// Deezer and the title rarely agree on accents or on the exact billing:
// "Beyonce" is still "Beyoncé", and "Calvin Harris feat. Rihanna" is still the
// same act. Either name containing the other is the same artist; a different
// one is a mismatch and the facts are refused.
export function artistMatches(candidate: string, expected: string): boolean {
  return containsWords(candidate, expected) || containsWords(expected, candidate)
}

export function mentionsName(text: string, name: string): boolean {
  return containsWords(text, name)
}

// A remaster suffix ("The Chain (2004 Remaster)") may wrap the hit's own name;
// a different song by the same artist must not pass.
export function titleMatches(candidate: string, track: string): boolean {
  return containsWords(candidate, track) || containsWords(track, candidate)
}

export function stripDecorations(raw: string): string {
  const [head = ''] = raw.split('|')

  return head
    .replace(DECORATION, ' ')
    .replace(CREDIT_BRACKET, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
    .trim()
}

// A YouTube title is either "Artist - Track" plus decoration, or a bare track
// that needs the caller's artist. The billing side is kept as written: it is
// only ever compared, never shown as the artist's name.
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
