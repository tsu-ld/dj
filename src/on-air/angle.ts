import type { ListenerProfile } from '../ports/listeners.ts'
import type { Track } from '../ports/music.ts'
import type { SongFacts, SongNews } from '../ports/song-facts.ts'
import { normalizeTitle } from '../core/text.ts'

export type Angle = 'welcome' | 'listener' | 'anniversary' | 'story' | 'news' | 'fact' | 'run'

export interface AngleInput {
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
const NEWS_MAX_AGE_DAYS = 14
// the request number including this song
const REQUEST_MILESTONES = new Set([1, 5, 10, 25, 50, 100])
const RELEASE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// Priority order after the welcome; run is always possible. A skip is context
// in the run, never an angle of its own.
const ORDER: readonly Angle[] = ['listener', 'anniversary', 'story', 'news', 'fact', 'run']

export interface Anniversary {
  // the exact age on the release day the window holds
  readonly years: number
  // days from `now` to that release day, negative when it has passed
  readonly days: number
}

// The release day within three days of today. A year alone cannot place the
// day, so it never makes an anniversary: "20 years" a month early is false.
export function anniversaryOf(facts: SongFacts | null, now: number): Anniversary | null {
  const date = RELEASE_DATE.exec(facts?.releaseDate ?? '')

  if (!date)
    return null

  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])]
  const today = new Date(now)
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

  // The window can cross New Year, so the release day is checked in the
  // years either side too.
  for (const candidate of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const days = Math.round((Date.UTC(candidate, month - 1, day) - todayStart) / DAY_MS)
    const years = candidate - year

    if (Math.abs(days) <= ANNIVERSARY_WINDOW_DAYS && years > 0)
      return { years, days }
  }

  return null
}

export function freshNews(facts: SongFacts | null, now: number): readonly SongNews[] {
  return (facts?.news ?? []).filter(item => now - item.publishedAt <= NEWS_MAX_AGE_DAYS * DAY_MS)
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

function fits(angle: Angle, input: AngleInput): boolean {
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
    case 'run':
      return true
    case 'welcome':
      return false
  }
}

export function pickAngle(input: AngleInput): Angle {
  if (input.first)
    return 'welcome'

  return ORDER.find(angle => angle !== input.lastAngle && fits(angle, input)) ?? 'run'
}
