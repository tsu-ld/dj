import type { SongNews } from '../../ports/song-facts.ts'
import { containsWords, normalizeName } from './title.ts'

const ITEM = /<item>([\s\S]*?)<\/item>/g
const TITLE = /<title>([\s\S]*?)<\/title>/
const PUB_DATE = /<pubDate>([\s\S]*?)<\/pubDate>/
const SOURCE = /<source[^>]*>([\s\S]*?)<\/source>/
const MAX_ITEMS = 3
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// A one-word billing is also an ordinary word, and the feed keeps answering it:
// "Queen" a monarch, "Chicago" a city, "Air" a gas, "Kiss" a gesture. For such
// a name only a headline that speaks about music itself can be about the act;
// a distinctive multi-word billing ("Daft Punk") stands on its own. A doubtful
// headline costs less than a made-up fact, so it is dropped. Words with an
// everyday sense (tour, single, track, rock, pop, festival) prove nothing.
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
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

// The outlet is repeated at the end of the title, so a masthead that carries
// the artist's name ("Chicago Tribune") would otherwise pass on the masthead
// alone after the name itself was no longer in the headline.
function withoutSource(title: string, source: string | null): string {
  const suffix = source === null ? '' : ` - ${source}`

  return suffix !== '' && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title
}

function hasMusicWord(title: string): boolean {
  return normalizeName(title).split(' ').some(word => MUSIC_WORDS.has(word))
}

// "Queen Camilla", "Air India", "Chicago Fire": a one-word name followed by
// another capitalised word names somebody else. A possessive is how a band
// credits its own member ("Queen's Brian May"), so that one stays.
function namesAnother(title: string, name: string): boolean {
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escapePattern(name)})(['’]s)?\\s+(\\p{L})`, 'iu')
  // The name is accent-free ("bjork"); the title keeps its case but drops its
  // accents too, so "Björk Reykjavik ..." is matched.
  const match = pattern.exec(title.normalize('NFD').replace(/\p{M}/gu, ''))
  const first = match?.[3] ?? ''

  return match?.[2] === undefined && first !== '' && first !== first.toLowerCase()
}

function isAboutArtist(title: string, name: string): boolean {
  if (!containsWords(title, name))
    return false

  if (name.includes(' '))
    return true

  return !namesAnother(title, name) && hasMusicWord(title)
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

    const rawTitle = textOf(block, TITLE)
    const published = textOf(block, PUB_DATE)

    if (rawTitle === null || published === null)
      continue

    const publishedAt = Date.parse(published)

    if (!Number.isFinite(publishedAt) || now - publishedAt > MAX_AGE_MS)
      continue

    const source = textOf(block, SOURCE)
    const title = withoutSource(rawTitle, source)

    if (!isAboutArtist(title, name))
      continue

    items.push({ title, source, publishedAt })

    if (items.length >= MAX_ITEMS)
      break
  }

  return items
}
