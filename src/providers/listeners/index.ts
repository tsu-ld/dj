import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { JsonRecord } from '../../core/json.ts'
import type { ListenersPort } from '../../ports/listeners.ts'
import type { ArtistStat, SongStat, StatTable } from './stats.ts'
import { isRecord } from '../../core/json.ts'
import { normalizeTitle } from '../../core/text.ts'
import { jsonMapFile, normalizeMap } from '../json-file.ts'
import {
  bumpArtist,
  countOf,
  keepTop,
  MAX_MEMBERS,
  MAX_SONGS,
  timestampOf,
  topArtists,
  topSong,
  WRITE_DELAY_MS,
} from './stats.ts'

interface StoredMember {
  name: string
  requests: number
  songs: Record<string, SongStat>
  artists: Record<string, ArtistStat>
  lastSeen: number
}

type StoredGuild = Record<string, StoredMember>

function normalizeCounts<T>(
  value: unknown,
  stat: (key: string, entry: JsonRecord, count: number) => T,
): StatTable<T> {
  if (!isRecord(value)) {
    return {}
  }

  const stats: StatTable<T> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (!key || !isRecord(entry)) {
      continue
    }

    const count = countOf(entry.count)

    if (count > 0) {
      stats[key] = stat(key, entry, count)
    }
  }

  return stats
}

function normalizeSongs(value: unknown): Record<string, SongStat> {
  return normalizeCounts(value, (key, song, count) => ({
    title: typeof song.title === 'string' ? song.title : key,
    count,
    lastRequested: timestampOf(song.lastRequested),
  }))
}

function normalizeArtists(value: unknown): Record<string, ArtistStat> {
  return normalizeCounts(value, (_, artist, count) => ({
    count,
    lastRequested: timestampOf(artist.lastRequested),
  }))
}

function normalizeMember(value: unknown): StoredMember | null {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return null
  }

  return {
    name: value.name,
    requests: countOf(value.requests),
    songs: normalizeSongs(value.songs),
    artists: normalizeArtists(value.artists),
    lastSeen: timestampOf(value.lastSeen),
  }
}

function capMembers(guild: StoredGuild): void {
  const ids = Object.keys(guild)

  if (ids.length <= MAX_MEMBERS) {
    return
  }

  ids.sort((left, right) => (guild[left]?.lastSeen ?? 0) - (guild[right]?.lastSeen ?? 0))

  for (const id of ids.slice(0, ids.length - MAX_MEMBERS)) {
    delete guild[id]
  }
}

export async function listenersStore(deps: {
  path: string
  logger: Logger
  clock: Clock
}): Promise<ListenersPort> {
  const { clock } = deps
  const store = jsonMapFile({
    path: deps.path,
    name: 'listeners',
    logger: deps.logger,
    entry: (value) => normalizeMap(value, normalizeMember),
  })
  const file = await store.read()
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule(): void {
    if (timer) {
      return
    }

    timer = setTimeout(() => {
      timer = null
      void store
        .write(file)
        .catch((error: unknown) => deps.logger.error('listeners.persist_failed', error))
    }, WRITE_DELAY_MS)
  }

  function memberOf(guildId: string, id: string, name: string): StoredMember {
    const guild = file[guildId] ?? {}
    const existing = guild[id]
    const at = clock.now()

    if (existing) {
      existing.name = name
      existing.lastSeen = at
      file[guildId] = guild

      return existing
    }

    const created: StoredMember = {
      name,
      requests: 0,
      songs: {},
      artists: {},
      lastSeen: at,
    }

    guild[id] = created
    file[guildId] = guild
    capMembers(guild)

    return created
  }

  return {
    recordRequest(guildId, listener, song) {
      const member = memberOf(guildId, listener.id, listener.name)
      member.requests += 1

      const key = normalizeTitle(song.title)
      const at = clock.now()

      if (key) {
        const previous = member.songs[key]
        const next = {
          ...member.songs,
          [key]: { title: song.title, count: (previous?.count ?? 0) + 1, lastRequested: at },
        }

        member.songs = keepTop(next, MAX_SONGS, key)
      }

      if (typeof song.artist === 'string' && song.artist.length > 0) {
        member.artists = bumpArtist(member.artists, song.artist, at)
      }

      schedule()
    },
    profile(guildId, listenerId) {
      const member = file[guildId]?.[listenerId]

      if (!member) {
        return null
      }

      return {
        name: member.name,
        requests: member.requests,
        topSong: topSong(member.songs),
        topArtists: topArtists(member.artists),
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      await store.write(file)
    },
  }
}
