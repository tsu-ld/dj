const DISCORD_MESSAGE_LIMIT = 2000
const DEFAULT_LINE_LENGTH = 120
const MAX_BLOCK_LINE_LENGTH = 500
const TAG_NAME = /^[a-z][a-z-]*$/
const BRACKETED = /\([^)]*\)|\[[^\]]*\]/g

// Slicing can split a surrogate pair at the cut; a trailing lone high surrogate
// is dropped rather than kept as half an emoji.
function wholeChars(text: string): string {
  const last = text.charCodeAt(text.length - 1)

  return last >= 0xD800 && last <= 0xDBFF ? text.slice(0, -1) : text
}

// Song titles, display names and personas arrive from outside: they are prompt
// data, so they lose markup, line breaks and their length.
export function oneLine(value: unknown, maxLength = DEFAULT_LINE_LENGTH): string {
  return wholeChars(String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength))
}

// Discord rejects messages over 2000 UTF-16 units. Empty input speaks nothing,
// so it comes back null.
export function clampMessage(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '')
    return null

  return wholeChars(text.trim().slice(0, DISCORD_MESSAGE_LIMIT)) || null
}

// The same song arrives with different decorations: the request text, a link
// title or an autoplay title. "Song (Official Video) [HD]" and "song" are one.
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(BRACKETED, ' ').replace(/\s+/g, ' ').trim()
}

// A data block is the only place untrusted text is allowed in a prompt. Every
// line is stripped, so a song title can never close the tag and become rules.
export function dataBlock(tag: string, lines: readonly unknown[]): string {
  if (!TAG_NAME.test(tag))
    throw new Error(`Invalid data block tag: ${tag}`)

  const clean = lines.map(line => oneLine(line, MAX_BLOCK_LINE_LENGTH))

  return `<${tag}>\n${clean.join('\n')}\n</${tag}>`
}
