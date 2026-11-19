import type { Logger } from '../../core/logger.ts'
import type { ListenersPort } from '../../ports/listeners.ts'
import type { ArtistStat, SongStat } from './stats.ts'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { errorMessage } from '../../core/errors.ts'
import { isRecord, parseJson } from '../../core/json.ts'
import { bumpArtist, countOf, keepTop, MAX_MEMBERS, MAX_SONGS, normalizeTitle, timestampOf, topArtists, topSong, WRITE_DELAY_MS } from './stats.ts'

interface StoredMember {
  name: string
  requests: number
  songs: Record<string, SongStat>
  artists: Record<string, ArtistStat>
  skipsGiven: number
  skippedByOthers: number
  firstSeen: number
  lastSeen: number
}

type StoredGuild = Record<string, StoredMember>
type StoredFile = Record<string, StoredGuild>

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
    const count = isRecord(entry) ? countOf(entry.count) : countOf(entry)
    const lastRequested = isRecord(entry) ? timestampOf(entry.lastRequested) : 0

    if (name && count > 0)
      artists[name] = { count, lastRequested }
  }

  return artists
}

// A member entry only needs a name; every other field falls back to its empty
// value, so a hand-edited or older file still loads.
function normalizeMember(value: unknown): StoredMember | null {
  if (!isRecord(value) || typeof value.name !== 'string')
    return null

  return {
    name: value.name,
    requests: countOf(value.requests),
    songs: normalizeSongs(value.songs),
    artists: normalizeArtists(value.artists),
    skipsGiven: countOf(value.skipsGiven),
    skippedByOthers: countOf(value.skippedByOthers),
    firstSeen: timestampOf(value.firstSeen),
    lastSeen: timestampOf(value.lastSeen),
  }
}

function normalizeGuild(value: unknown): StoredGuild | null {
  if (!isRecord(value))
    return null

  const entries = Object.entries(value)

  if (entries.length > 0 && !entries.some(([, member]) => isRecord(member)))
    return null

  const guild: StoredGuild = {}

  for (const [id, member] of entries) {
    const normalized = normalizeMember(member)

    if (normalized)
      guild[id] = normalized
  }

  return guild
}

// The file is a guild map. One bad guild or member drops only that entry; a
// file where no guild is an object is not a listeners file and is quarantined.
function normalizeMap(value: unknown): StoredFile | null {
  if (!isRecord(value))
    return null

  const entries = Object.entries(value)

  if (entries.length > 0 && !entries.some(([, guild]) => isRecord(guild)))
    return null

  const guilds: StoredFile = {}

  for (const [guildId, guild] of entries) {
    const normalized = normalizeGuild(guild)

    if (normalized)
      guilds[guildId] = normalized
  }

  return guilds
}

async function read(filePath: string, logger: Logger): Promise<StoredFile> {
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  }
  catch (error) {
    if (isRecord(error) && error.code === 'ENOENT')
      return {}

    throw error
  }

  const parsed = normalizeMap(parseJson(text))

  if (parsed)
    return parsed

  const backup = `${filePath}.corrupt-${Date.now()}`

  try {
    await rename(filePath, backup)
    logger.warn('listeners.quarantined', { path: filePath, backup })
  }
  catch (error) {
    logger.warn('listeners.quarantine_failed', { path: filePath, error: errorMessage(error) })
  }

  return {}
}

function capMembers(guild: StoredGuild): void {
  const ids = Object.keys(guild)

  if (ids.length <= MAX_MEMBERS)
    return

  ids.sort((left, right) => (guild[left]?.lastSeen ?? 0) - (guild[right]?.lastSeen ?? 0))

  for (const id of ids.slice(0, ids.length - MAX_MEMBERS))
    delete guild[id]
}

export async function listenersStore(deps: { path: string, logger: Logger, now?: () => number }): Promise<ListenersPort> {
  const { logger, path } = deps
  const now = deps.now ?? (() => Date.now())
  const file = await read(path, logger)
  let timer: ReturnType<typeof setTimeout> | null = null
  let writes: Promise<void> = Promise.resolve()

  async function persist(): Promise<void> {
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.tmp`

      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`)
      await rename(temporary, path)
    })

    return writes
  }

  function schedule(): void {
    if (timer)
      return

    timer = setTimeout(() => {
      timer = null
      void persist().catch(error => logger.error('listeners.persist_failed', error))
    }, WRITE_DELAY_MS)
  }

  function memberOf(guildId: string, id: string, name: string): StoredMember {
    const guild = file[guildId] ?? {}
    const existing = guild[id]
    const at = now()

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
      skipsGiven: 0,
      skippedByOthers: 0,
      firstSeen: at,
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
      const at = now()

      if (key) {
        const previous = member.songs[key]
        const next = { ...member.songs, [key]: { title: song.title, count: (previous?.count ?? 0) + 1, lastRequested: at } }

        member.songs = keepTop(next, MAX_SONGS, key)
      }

      if (typeof song.artist === 'string' && song.artist.length > 0)
        member.artists = bumpArtist(member.artists, song.artist, at)

      schedule()
    },
    recordSkip(guildId, by, song) {
      const skipper = memberOf(guildId, by.id, by.name)
      skipper.skipsGiven += 1

      // A self-skip is not someone else skipping your song; it never touches
      // skippedByOthers. A requester with no profile yet has no name to store.
      const requester = song.requesterId !== null && song.requesterId !== by.id
        ? file[guildId]?.[song.requesterId]
        : undefined

      if (requester)
        requester.skippedByOthers += 1

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
        skipsGiven: member.skipsGiven,
        skippedByOthers: member.skippedByOthers,
        firstSeen: member.firstSeen,
      }
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      await persist()
    },
  }
}
