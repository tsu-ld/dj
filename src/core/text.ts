const DISCORD_MAX_MESSAGE_UTF16_UNITS = 2000
const HIGH_SURROGATE_FIRST = 0xd8_00
const HIGH_SURROGATE_LAST = 0xdb_ff
const DEFAULT_LINE_LENGTH = 120
const MAX_BLOCK_LINE_LENGTH = 500
const TAG_NAME = /^[a-z][a-z-]*$/
const BRACKETED = /\([^)]*\)|\[[^\]]*\]/g

export function cutAt(text: string, maxLength: number): string {
  const cut = text.slice(0, maxLength)

  return endsInHalfSurrogatePair(cut) ? cut.slice(0, -1) : cut
}

function endsInHalfSurrogatePair(text: string): boolean {
  const last = text.charCodeAt(text.length - 1)

  return last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST
}

export function oneLine(value: unknown, maxLength = DEFAULT_LINE_LENGTH): string {
  return cutAt(
    String(value ?? '')
      .replaceAll(/[<>]/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim(),
    maxLength,
  )
}

export function clampMessage(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '') {
    return null
  }

  return cutAt(text.trim(), DISCORD_MAX_MESSAGE_UTF16_UNITS) || null
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replaceAll(BRACKETED, ' ').replaceAll(/\s+/g, ' ').trim()
}

export function dataBlock(tag: string, lines: ReadonlyArray<unknown>): string {
  if (!TAG_NAME.test(tag)) {
    throw new Error(`Invalid data block tag: ${tag}`)
  }

  const clean = lines.map((line) => oneLine(line, MAX_BLOCK_LINE_LENGTH))

  return `<${tag}>\n${clean.join('\n')}\n</${tag}>`
}
