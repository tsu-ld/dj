const DISCORD_MESSAGE_LIMIT = 2000
const DEFAULT_LINE_LENGTH = 120
const MAX_BLOCK_LINE_LENGTH = 500
const TAG_NAME = /^[a-z][a-z-]*$/

// Song titles, display names and personas arrive from outside: they are prompt
// data, so they lose markup, line breaks and their length.
export function oneLine(value: unknown, maxLength = DEFAULT_LINE_LENGTH): string {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

// Discord rejects messages over 2000 UTF-16 units, and slicing can split a
// surrogate pair at the boundary; drop a trailing lone high surrogate rather
// than send half an emoji. Empty input speaks nothing, so it comes back null.
export function clampMessage(text: string | null | undefined, limit = DISCORD_MESSAGE_LIMIT): string | null {
  if (text === null || text === undefined || text === '')
    return null

  const clamped = text.trim().slice(0, limit)
  const last = clamped.charCodeAt(clamped.length - 1)
  const whole = last >= 0xD800 && last <= 0xDBFF ? clamped.slice(0, -1) : clamped

  return whole || null
}

// A data block is the only place untrusted text is allowed in a prompt. Every
// line is stripped, so a song title can never close the tag and become rules.
export function dataBlock(tag: string, lines: readonly unknown[]): string {
  if (!TAG_NAME.test(tag))
    throw new Error(`Invalid data block tag: ${tag}`)

  const clean = lines.map(line => oneLine(line, MAX_BLOCK_LINE_LENGTH))

  return `<${tag}>\n${clean.join('\n')}\n</${tag}>`
}
