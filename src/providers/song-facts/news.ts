import type { SongNews } from '../../ports/song-facts.ts'
import { NEWS_MAX_AGE_MS } from '../../limits.ts'
import { containsWords, normalizeName } from './title.ts'

const ITEM = /<item>([\s\S]*?)<\/item>/g
const TITLE = /<title>([\s\S]*?)<\/title>/
const PUB_DATE = /<pubDate>([\s\S]*?)<\/pubDate>/
const SOURCE = /<source[^>]*>([\s\S]*?)<\/source>/
const MAX_ITEMS = 3

const MUSIC_WORDS = new Set([
  'album',
  'albums',
  'band',
  'banda',
  'bandas',
  'bands',
  'bassist',
  'cancion',
  'canciones',
  'cantante',
  'cantantes',
  'cumbia',
  'concert',
  'concerts',
  'concierto',
  'conciertos',
  'disco',
  'discos',
  'drummer',
  'electronica',
  'ep',
  'grammy',
  'grammys',
  'guitar',
  'guitarra',
  'guitarist',
  'guitarrista',
  'indie',
  'jazz',
  'lp',
  'lyrics',
  'music',
  'musica',
  'musical',
  'musician',
  'musico',
  'musicos',
  'punk',
  'recital',
  'recitals',
  'reggae',
  'remaster',
  'remastered',
  'remix',
  'singer',
  'singers',
  'song',
  'songs',
  'songwriter',
  'soundtrack',
  'tango',
  'vinyl',
  'vocalist',
])

function escapePattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function fromCodePointOrEmpty(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10_ff_ff ? String.fromCodePoint(code) : ''
}

function decodeEntities(raw: string): string {
  return raw
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replaceAll(/&#(\d+);/g, (_, code: string) => fromCodePointOrEmpty(Number(code)))
    .replaceAll(/&#x([\da-f]+);/gi, (_, code: string) =>
      fromCodePointOrEmpty(Number.parseInt(code, 16)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function textOf(block: string, pattern: RegExp): string | null {
  const match = pattern.exec(block)
  const value = match?.[1]

  return value === undefined ? null : decodeEntities(value).trim()
}

function withoutOutletSuffix(title: string, source: string | null): string {
  const suffix = source === null ? '' : ` - ${source}`

  return suffix !== '' && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

function hasMusicWord(title: string): boolean {
  return normalizeName(title)
    .split(' ')
    .some((word) => MUSIC_WORDS.has(word))
}

function namesAnother(title: string, name: string): boolean {
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${escapePattern(name)})(['’]s)?\\s+(\\p{L})`,
    'iu',
  )
  const match = pattern.exec(title.normalize('NFD').replaceAll(/\p{M}/gu, ''))
  const first = match?.[3] ?? ''

  return match?.[2] === undefined && first !== '' && first !== first.toLowerCase()
}

function isAboutArtist(title: string, name: string): boolean {
  if (!containsWords(title, name)) {
    return false
  }

  if (name.includes(' ')) {
    return true
  }

  return !namesAnother(title, name) && hasMusicWord(title)
}

export function parseNews(xml: string, artist: string, now: number): Array<SongNews> {
  const name = normalizeName(artist)

  if (!name) {
    return []
  }

  const items: Array<SongNews> = []

  for (const match of xml.matchAll(ITEM)) {
    const block = match[1]

    if (block === undefined) {
      continue
    }

    const rawTitle = textOf(block, TITLE)
    const published = textOf(block, PUB_DATE)

    if (rawTitle === null || published === null) {
      continue
    }

    const publishedAt = Date.parse(published)

    if (!Number.isFinite(publishedAt) || now - publishedAt > NEWS_MAX_AGE_MS) {
      continue
    }

    const source = textOf(block, SOURCE)
    const title = withoutOutletSuffix(rawTitle, source)

    if (!isAboutArtist(title, name)) {
      continue
    }

    items.push({ title, source, publishedAt })

    if (items.length >= MAX_ITEMS) {
      break
    }
  }

  return items
}
