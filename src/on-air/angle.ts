import type { ListenerProfile } from '../ports/listeners.ts'
import type { Track } from '../ports/music.ts'
import type { SongFacts, SongNews } from '../ports/song-facts.ts'
import { normalizeTitle } from '../core/text.ts'
import { NEWS_MAX_AGE_MS } from '../limits.ts'

export type Angle = 'welcome' | 'listener' | 'anniversary' | 'story' | 'news' | 'fact' | 'run'

interface AngleInput {
  readonly long: boolean
  readonly first: boolean
  readonly track: Track
  readonly facts: SongFacts | null
  readonly listener: ListenerProfile | null
  readonly lastAngle: Angle | null
  readonly now: number
}

export const DAY_MS = 86_400_000
const ANNIVERSARY_WINDOW_DAYS = 3
const REQUEST_MILESTONES = new Set([1, 5, 10, 25, 50, 100])
const RELEASE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const ORDER: readonly Exclude<Angle, 'welcome' | 'run'>[] = ['listener', 'anniversary', 'story', 'news', 'fact']

interface Anniversary {
  readonly years: number
  readonly days: number
}

export function anniversaryOf(facts: SongFacts | null, now: number): Anniversary | null {
  const date = RELEASE_DATE.exec(facts?.releaseDate ?? '')

  if (!date)
    return null

  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
  const today = new Date(now)
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

  for (const candidate of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const days = Math.round((Date.UTC(candidate, month - 1, day) - todayStart) / DAY_MS)
    const years = candidate - year

    if (Math.abs(days) <= ANNIVERSARY_WINDOW_DAYS && years > 0)
      return { years, days }
  }

  return null
}

export function freshNews(facts: SongFacts | null, now: number): readonly SongNews[] {
  return (facts?.news ?? []).filter(item => now - item.publishedAt <= NEWS_MAX_AGE_MS)
}

function isListenerMilestone(track: Track, listener: ListenerProfile | null): boolean {
  if (listener === null || track.fromRadio)
    return false

  if (REQUEST_MILESTONES.has(listener.requests + 1))
    return true

  if (listener.topSong !== null && normalizeTitle(listener.topSong.title) === normalizeTitle(track.title))
    return true

  const artist = track.artist?.trim().toLowerCase() ?? ''

  return artist !== '' && listener.topArtists.some(top => top.trim().toLowerCase() === artist)
}

function fits(angle: Exclude<Angle, 'welcome' | 'run'>, input: AngleInput): boolean {
  const { facts } = input

  switch (angle) {
    case 'listener':
      return isListenerMilestone(input.track, input.listener)
    case 'anniversary':
      return anniversaryOf(facts, input.now) !== null
    case 'story':
      return input.long && Boolean(facts?.songSummary)
    case 'news':
      return freshNews(facts, input.now).length > 0
    case 'fact':
      return facts !== null && (Boolean(facts.album) || facts.year !== null || Boolean(facts.genre))
  }
}

export function pickAngle(input: AngleInput): Angle {
  if (input.first)
    return 'welcome'

  return ORDER.find(angle => angle !== input.lastAngle && fits(angle, input)) ?? 'run'
}
