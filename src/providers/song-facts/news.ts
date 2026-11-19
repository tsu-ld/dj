import type { SongNews } from '../../ports/song-facts.ts'
import { containsWords, normalizeName } from './title.ts'

const ITEM = /<item>([\s\S]*?)<\/item>/g
const TITLE = /<title>([\s\S]*?)<\/title>/
const PUB_DATE = /<pubDate>([\s\S]*?)<\/pubDate>/
const SOURCE = /<source[^>]*>([\s\S]*?)<\/source>/
const MAX_ITEMS = 3
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// A feed can carry a broken entity (&#99999999;); String.fromCodePoint throws on
// it and would take every headline down. Drop the offending entity instead.
function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : ''
}

// Titles and sources arrive as XML text, sometimes inside CDATA and always with
// entities: the host reads these strings out loud, so they must be plain text.
function decodeEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code: string) => fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function textOf(block: string, pattern: RegExp): string | null {
  const match = pattern.exec(block)
  const value = match?.[1]

  return value === undefined ? null : decodeEntities(value).trim()
}

// Only news about this artist, and only news a host can still call news: an
// item older than a month or about somebody else would be a made-up fact.
export function parseNews(xml: string, artist: string, now: number): SongNews[] {
  const name = normalizeName(artist)

  if (!name)
    return []

  const items: SongNews[] = []

  for (const match of xml.matchAll(ITEM)) {
    const block = match[1]

    if (block === undefined)
      continue

    const title = textOf(block, TITLE)
    const published = textOf(block, PUB_DATE)

    if (title === null || published === null)
      continue

    const publishedAt = Date.parse(published)

    if (!Number.isFinite(publishedAt) || now - publishedAt > MAX_AGE_MS)
      continue

    if (!containsWords(title, name))
      continue

    const source = textOf(block, SOURCE)
    const suffix = source === null ? '' : ` - ${source}`

    items.push({
      title: suffix !== '' && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title,
      source,
      publishedAt,
    })

    if (items.length >= MAX_ITEMS)
      break
  }

  return items
}
