import type { Json, JsonRecord } from '../../core/json.ts'
import { isRecord } from '../../core/json.ts'

const TOPIC_CHANNEL_SUFFIX = ' - Topic'

export function infoRecord(value: Json): JsonRecord {
  if (!isRecord(value)) {
    throw new Error('The extractor returned an unexpected metadata payload.')
  }

  return value
}

export function idOf(info: JsonRecord): string | null {
  const id = info.id

  if (typeof id === 'string') {
    return id
  }

  return typeof id === 'number' ? String(id) : null
}

export function stringOf(info: JsonRecord, key: string): string | null {
  const value = info[key]

  return typeof value === 'string' && value !== '' ? value : null
}

export function numberOf(info: JsonRecord, key: string): number | undefined {
  const value = info[key]

  return typeof value === 'number' ? value : undefined
}

export function recordsOf(value: Json | undefined): Array<JsonRecord> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export function isLiveInfo(info: JsonRecord): boolean {
  return (
    Boolean(info.is_live) || info.live_status === 'is_live' || info.live_status === 'is_upcoming'
  )
}

export function thumbnailOf(info: JsonRecord): string | undefined {
  const direct = stringOf(info, 'thumbnail')

  if (direct !== null) {
    return direct
  }

  const thumbnails = recordsOf(info.thumbnails)

  return stringOf(thumbnails[0] ?? {}, 'url') ?? undefined
}

export function songUrlOf(info: JsonRecord): string | undefined {
  const direct = stringOf(info, 'webpage_url') ?? stringOf(info, 'original_url')

  if (direct !== null) {
    return direct
  }

  const isFlatPlaylistEntry = info._type === 'url'

  return isFlatPlaylistEntry ? (stringOf(info, 'url') ?? undefined) : undefined
}

export function artistOf(info: JsonRecord): string | null {
  const credited = stringOf(info, 'artist') ?? stringOf(info, 'creator')

  if (credited !== null) {
    return credited
  }

  const topic = [stringOf(info, 'uploader'), stringOf(info, 'channel')].find((name) =>
    name?.endsWith(TOPIC_CHANNEL_SUFFIX),
  )
  const name = topic?.slice(0, -TOPIC_CHANNEL_SUFFIX.length).trim()

  return name === undefined || name === '' ? null : name
}
