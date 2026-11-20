import { isRecord } from '../../core/json.ts'
import { containsWords, normalizeName } from './title.ts'

const SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const SEARCH_URL = 'https://en.wikipedia.org/w/rest.php/v1/search/page'
const SONG_HIT_LIMIT = 3
const ARTIST_SUMMARY_LIMIT = 200
const SONG_SUMMARY_LIMIT = 300

function cap(text: string, limit: number): string {
  if (text.length <= limit)
    return text

  const cut = text.slice(0, limit)
  const wordEnd = cut.lastIndexOf(' ')

  return (wordEnd > 0 ? cut.slice(0, wordEnd) : cut).trim()
}

function sentences(extract: string, count: number): string {
  return extract.trim().split(/(?<=[.!?])\s+/).slice(0, count).join(' ').trim()
}

export function artistPageUrl(artist: string): string {
  return `${SUMMARY_URL}/${encodeURIComponent(artist.replace(/\s+/g, '_'))}`
}

export function songSearchUrl(title: string, artist: string): string {
  return `${SEARCH_URL}?q=${encodeURIComponent(`${title} ${artist} song`)}&limit=${SONG_HIT_LIMIT}`
}

export function pageSummaryUrl(key: string): string {
  return `${SUMMARY_URL}/${encodeURIComponent(key)}`
}

export interface PageHit {
  readonly key: string
  readonly title: string
}

export function pageHits(payload: unknown): PageHit[] {
  const pages = isRecord(payload) && Array.isArray(payload.pages) ? payload.pages : []
  const hits: PageHit[] = []

  for (const page of pages.slice(0, SONG_HIT_LIMIT)) {
    if (!isRecord(page) || typeof page.key !== 'string')
      continue

    hits.push({ key: page.key, title: typeof page.title === 'string' ? page.title : page.key })
  }

  return hits
}

export function artistSummary(payload: unknown): string | null {
  if (!isRecord(payload) || payload.type === 'disambiguation')
    return null

  const extract = typeof payload.extract === 'string' ? payload.extract : ''

  if (!/\b(?:music[a-z]*|singer|band|rapper|producer|dj|songwriter|composer)\b/i.test(extract))
    return null

  const sentence = sentences(extract, 1)

  if (!sentence)
    return null

  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const text = description && !sentence.toLowerCase().includes(description.toLowerCase())
    ? `${description}. ${sentence}`
    : sentence

  return cap(text, ARTIST_SUMMARY_LIMIT)
}

export function songSummary(payload: unknown, pageTitle: string, artist: string, track: string): string | null {
  if (!isRecord(payload) || payload.type === 'disambiguation')
    return null

  // Wikipedia's search for "<track> <artist> song" answers the artist's page first.
  if (normalizeName(pageTitle) === normalizeName(artist))
    return null

  const extract = typeof payload.extract === 'string' ? payload.extract : ''

  if (!containsWords(extract, artist))
    return null

  if (!containsWords(pageTitle, track) && !containsWords(extract, track))
    return null

  const text = sentences(extract, 2)

  return text ? cap(text, SONG_SUMMARY_LIMIT) : null
}
