import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { ListenersPort } from '../../ports/listeners.ts'
import type { ArtistStat, SongStat } from './stats.ts'
import { isRecord } from '../../core/json.ts'
import { normalizeTitle } from '../../core/text.ts'
import { jsonMapFile, normalizeMap } from '../json-file.ts'
import { bumpArtist, countOf, keepTop, MAX_MEMBERS, MAX_SONGS, timestampOf, topArtists, topSong, WRITE_DELAY_MS } from './stats.ts'

interface StoredMember {
  name: string
  requests: number
  songs: Record<string, SongStat>
  artists: Record<string, ArtistStat>
  lastSeen: number
}

type StoredGuild = Record<string, StoredMember>

function normalizeSongs(value: unknown): Record<string, SongStat> {
  if (!isRecord(value))
    return {}

  const songs: Record<string, SongStat> = {}

  for (const [key, song] of Object.entries(value)) {
    if (!key || !isRecord(song))
      continue

    const count = countOf(song.count)

    if (count === 0)
      continue

    songs[key] = {
      title: typeof song.title === 'string' ? song.title : key,
      count,
      lastRequested: timestampOf(song.lastRequested),
    }
  }

  return songs
}

function normalizeArtists(value: unknown): Record<string, ArtistStat> {
  if (!isRecord(value))
    return {}

  const artists: Record<string, ArtistStat> = {}

  for (const [name, entry] of Object.entries(value)) {
    if (!name || !isRecord(entry) || countOf(entry.count) === 0)
      continue

    artists[name] = { count: countOf(entry.count), lastRequested: timestampOf(entry.lastRequested) }
  }

  return artists
}

// A member entry only needs a name; every other field falls back to its empty
// value and unknown fields are dropped, so a hand-edited or older file loads.
function normalizeMember(value: unknown): StoredMember | null {
  if (!isRecord(value) || typeof value.name !== 'string')
    return null

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

  if (ids.length <= MAX_MEMBERS)
    return

  ids.sort((left, right) => (guild[left]?.lastSeen ?? 0) - (guild[right]?.lastSeen ?? 0))

  for (const id of ids.slice(0, ids.length - MAX_MEMBERS))
    delete guild[id]
}

export async function listenersStore(deps: { path: string, logger: Logger, clock: Clock }): Promise<ListenersPort> {
  const { clock } = deps
  // The file maps guilds to members. One bad guild or member drops only that
  // entry; a file where no guild is an object is quarantined.
  const store = jsonMapFile({ path: deps.path, name: 'listeners', logger: deps.logger, entry: value => normalizeMap(value, normalizeMember) })
  const file = await store.read()
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule(): void {
    if (timer)
      return

    timer = setTimeout(() => {
      timer = null
      void store.write(file).catch(error => deps.logger.error('listeners.persist_failed', error))
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
        const next = { ...member.songs, [key]: { title: song.title, count: (previous?.count ?? 0) + 1, lastRequested: at } }

        member.songs = keepTop(next, MAX_SONGS, key)
      }

      if (typeof song.artist === 'string' && song.artist.length > 0)
        member.artists = bumpArtist(member.artists, song.artist, at)

      schedule()
    },
    profile(guildId, listenerId) {
      const member = file[guildId]?.[listenerId]

      if (!member)
        return null

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
