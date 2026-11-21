import type { QueueView, Track } from '../ports/music.ts'
import { oneLine } from '../core/text.ts'

export const PLAYING_ACCENT = 0x57_f2_87
export const PAUSED_ACCENT = 0xfe_e7_5c

const UPCOMING_ON_CARD = 3
const TITLE_MAX = 100
const QUEUE_TITLE_MAX = 64
const REQUESTER_MAX = 40
const MARKDOWN = /[\\*_~`|>[\]]/g

function httpUrl(value: string | null): string | null {
  if (value === null || value === '') {
    return null
  }

  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }

    return url.href.replaceAll('(', '%28').replaceAll(')', '%29')
  } catch {
    return null
  }
}

function displayName(track: Track, maxLength: number): string {
  return oneLine(track.title, maxLength) || oneLine(track.url, maxLength) || 'Unknown song'
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(MARKDOWN, String.raw`\$&`)
}

export function thumbnailUrl(track: Track): string | null {
  return httpUrl(track.thumbnail)
}

export function clock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

function shownDuration(track: Track): string | null {
  if (track.isLive) {
    return 'Live'
  }

  if (!Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0) {
    return null
  }

  return clock(Math.floor(track.durationSeconds))
}

function durationSuffix(track: Track): string {
  const duration = shownDuration(track)

  return duration === null ? '' : ` · ${duration}`
}

export function linkedTitle(track: Track): string {
  const title = escapeMarkdown(displayName(track, TITLE_MAX))
  const url = httpUrl(track.url)

  return url === null ? title : `[${title}](${url})`
}

function requesterLabel(track: Track): string | null {
  if (track.fromRadio) {
    return 'Picked by radio'
  }

  const name = oneLine(track.requestedBy, REQUESTER_MAX)

  return name === '' ? null : `Requested by ${escapeMarkdown(name)}`
}

export function statusLine(track: Track, view: QueueView): string {
  const parts = [view.paused ? '**Paused**' : '**Playing**']
  const duration = shownDuration(track)

  if (duration !== null) {
    parts.push(duration)
  }

  const requester = requesterLabel(track)

  if (requester !== null) {
    parts.push(requester)
  }

  const details: Array<string> = []
  const waiting = Math.max(view.size - 1, 0)

  if (waiting > 0) {
    details.push(`${waiting} in queue`)
  }

  if (view.radio) {
    details.push('radio on')
  }

  return details.length === 0
    ? parts.join(' · ')
    : `${parts.join(' · ')}\n-# ${details.join(' · ')}`
}

export function upcomingText(view: QueueView): string | null {
  if (view.upcoming.length === 0) {
    return null
  }

  const shown = view.upcoming.slice(0, UPCOMING_ON_CARD)
  const lines = shown.map((track, index) => queueLine(track, index + 2, ''))
  const hidden = view.upcoming.length - shown.length

  if (hidden > 0) {
    lines.push(`-# and ${hidden} more`)
  }

  return `**Up next**\n${lines.join('\n')}`
}

export function queueLine(track: Track, position: number, marker: string): string {
  return `${marker}${position}. ${escapeMarkdown(displayName(track, QUEUE_TITLE_MAX))}${durationSuffix(track)}`
}

export function totalDuration(songs: ReadonlyArray<Track>): string | null {
  let seconds = 0
  let unknown = 0

  for (const track of songs) {
    if (Number.isFinite(track.durationSeconds) && track.durationSeconds > 0) {
      seconds += track.durationSeconds
    } else {
      unknown++
    }
  }

  if (seconds === 0) {
    return null
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `${unknown > 0 ? '~' : ''}${Math.max(minutes, 1)}m`
  }

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const label = rest === 0 ? `${hours}h` : `${hours}h ${rest}m`

  return `${unknown > 0 ? '~' : ''}${label}`
}
