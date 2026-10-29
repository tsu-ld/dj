import type { ResolveOptions } from 'distube'
import type { Logger } from '../../core/logger.ts'
import type { Track } from '../../ports/music.ts'
import type { Extractor } from './extraction.ts'
import type { StreamResolver } from './stream.ts'
import { ExtractorPlugin, Playlist, Song } from 'distube'
import { isRecord } from '../../core/json.ts'
import { MAX_PLAYLIST_SONGS } from '../../limits.ts'
import { assertYoutubeUrl, liveError } from './policy.ts'

const RELATED_SONGS_LIMIT = 10

function idOf(info: Record<string, unknown>): string | null {
  const id = info.id

  if (typeof id === 'string')
    return id

  return typeof id === 'number' ? String(id) : null
}

function stringOf(info: Record<string, unknown>, key: string): string | null {
  const value = info[key]

  return typeof value === 'string' && value !== '' ? value : null
}

function numberOf(info: Record<string, unknown>, key: string): number | undefined {
  const value = info[key]

  return typeof value === 'number' ? value : undefined
}

function recordsOf(value: unknown): Array<Record<string, unknown>> {
  const entries: readonly unknown[] = Array.isArray(value) ? value : []

  return entries.filter(isRecord)
}

function isLiveInfo(info: Record<string, unknown>): boolean {
  return Boolean(info.is_live) || info.live_status === 'is_live' || info.live_status === 'is_upcoming'
}

function thumbnailOf(info: Record<string, unknown>): string | undefined {
  const direct = stringOf(info, 'thumbnail')

  if (direct !== null)
    return direct

  const thumbnails = recordsOf(info.thumbnails)

  return stringOf(thumbnails[0] ?? {}, 'url') ?? undefined
}

function songUrlOf(info: Record<string, unknown>): string | undefined {
  const direct = stringOf(info, 'webpage_url') ?? stringOf(info, 'original_url')

  if (direct !== null)
    return direct

  return info._type === 'url' ? stringOf(info, 'url') ?? undefined : undefined
}

function infoRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw new Error('The extractor returned an unexpected metadata payload.')

  return value
}

export class MusicCatalog extends ExtractorPlugin {
  readonly #extraction: Extractor
  readonly #stream: StreamResolver
  readonly #logger: Logger
  readonly #radioSongs = new WeakSet<object>()

  constructor(deps: { extraction: Extractor, stream: StreamResolver, logger: Logger }) {
    super()
    this.#extraction = deps.extraction
    this.#stream = deps.stream
    this.#logger = deps.logger
  }

  // validate() stays permissive on purpose: the SDK only follows a redirect with
  // a HEAD request when no plugin validates the URL, so the allowlist is
  // enforced in resolve() and before play().
  override validate(): boolean {
    return true
  }

  override async getRelatedSongs(song: { readonly id?: string }): Promise<Song[]> {
    if (song.id === undefined || song.id === '')
      return []

    try {
      // RD<id> is YouTube's mix (radio) playlist for that video.
      const info = infoRecord(await this.#extraction.json(
        `https://www.youtube.com/watch?v=${song.id}&list=RD${song.id}`,
        ['--flat-playlist', '--playlist-end', String(RELATED_SONGS_LIMIT)],
      ))

      return recordsOf(info.entries)
        .filter(entry => idOf(entry) !== null && idOf(entry) !== song.id && !isLiveInfo(entry))
        .slice(0, RELATED_SONGS_LIMIT)
        .map(entry => this.buildSong(entry, {}, true))
    }
    catch (error) {
      this.#logger.error('music.related_failed', error)

      return []
    }
  }

  override async searchSong<T>(query: string, options: ResolveOptions<T>): Promise<Song<T> | null> {
    const info = infoRecord(await this.#extraction.json(`ytsearch1:${query}`, ['--no-playlist']))
    const first = recordsOf(info.entries)[0]

    return first ? this.buildSong(first, options) : null
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    assertYoutubeUrl(url)

    const info = infoRecord(await this.#extraction.json(url, ['--flat-playlist', '--playlist-end', String(MAX_PLAYLIST_SONGS)]))

    if (info._type === 'playlist') {
      const entries = recordsOf(info.entries).filter(entry => idOf(entry) !== null)

      if (entries.length === 0)
        throw new Error('The playlist is empty.')

      const playable = entries.filter(entry => !isLiveInfo(entry))

      if (playable.length === 0)
        throw liveError()

      if (playable.length < entries.length)
        this.#logger.info('music.playlist_live_skipped', { skipped: entries.length - playable.length })

      const playlistSize = numberOf(info, 'playlist_count') ?? entries.length

      if (playlistSize > MAX_PLAYLIST_SONGS)
        this.#logger.info('music.playlist_capped', { size: playlistSize, max: MAX_PLAYLIST_SONGS })

      return new Playlist<T>(
        {
          source: stringOf(info, 'extractor') ?? 'youtube',
          songs: playable.slice(0, MAX_PLAYLIST_SONGS).map(entry => this.buildSong(entry, options)),
          id: idOf(info) ?? undefined,
          name: stringOf(info, 'title') ?? undefined,
          url: stringOf(info, 'webpage_url') ?? undefined,
          thumbnail: thumbnailOf(info),
        },
        options,
      )
    }

    if (isLiveInfo(info))
      throw liveError()

    return this.buildSong(info, options)
  }

  override async getStreamURL<T>(song: Song<T>): Promise<string> {
    if (song.isLive)
      throw liveError()

    return this.#stream.playableUrl(song)
  }

  buildSong<T>(info: Record<string, unknown>, options: ResolveOptions<T>, fromRadio = false): Song<T> {
    const live = isLiveInfo(info)

    this.#stream.remember(idOf(info), info.formats)

    const song = new Song<T>(
      {
        plugin: this,
        source: stringOf(info, 'extractor') ?? 'youtube',
        playFromSource: true,
        id: idOf(info) ?? '',
        name: stringOf(info, 'title') ?? stringOf(info, 'fulltitle') ?? undefined,
        // flat playlist entries carry their watch URL as url, not webpage_url
        url: songUrlOf(info),
        isLive: live,
        thumbnail: thumbnailOf(info),
        duration: live ? 0 : numberOf(info, 'duration'),
        uploader: {
          name: stringOf(info, 'uploader') ?? undefined,
          url: stringOf(info, 'uploader_url') ?? undefined,
        },
        views: numberOf(info, 'view_count'),
        likes: numberOf(info, 'like_count'),
        ageRestricted: (numberOf(info, 'age_limit') ?? 0) >= 18,
      },
      options,
    )

    // Autoplay adds related songs behind the user's back: the dj talks less over
    // them, and the queue marks them as radio.
    if (fromRadio)
      this.#radioSongs.add(song)

    return song
  }

  trackOf(song: Song): Track {
    return {
      id: song.id,
      title: song.name ?? song.url ?? 'Unknown song',
      url: song.url ?? '',
      durationSeconds: song.isLive ? 0 : song.duration,
      isLive: Boolean(song.isLive),
      thumbnail: song.thumbnail ?? null,
      requestedBy: song.member?.displayName ?? null,
      fromRadio: this.#radioSongs.has(song),
    }
  }
}
