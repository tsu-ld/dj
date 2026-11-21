import type { DisTube, ResolveOptions } from 'distube'
import type { JsonRecord } from '../../core/json.ts'
import type { Logger } from '../../core/logger.ts'
import type { Track } from '../../ports/music.ts'
import type { Extractor } from './extraction.ts'
import type { StreamResolver } from './stream.ts'
import { ExtractorPlugin, Playlist, Song } from 'distube'
import { errorMessage } from '../../core/errors.ts'
import { MAX_PLAYLIST_SONGS } from '../../limits.ts'
import {
  artistOf,
  idOf,
  infoRecord,
  isLiveInfo,
  numberOf,
  recordsOf,
  stringOf,
  thumbnailOf,
  songUrlOf,
} from './extractor-info.ts'
import { assertYoutubeUrl, liveError } from './policy.ts'
import { presentFields } from './present-fields.ts'
import { recentTitles, sameSong, titleKeys } from './titles.ts'

const RELATED_FETCH_LIMIT = 25

interface RelatedSeed {
  readonly id?: string | undefined
  readonly name?: string | undefined
  readonly member?: { readonly guild: { readonly id: string } } | undefined
}

export class MusicCatalog extends ExtractorPlugin {
  readonly #extraction: Extractor
  readonly #stream: StreamResolver
  readonly #logger: Logger
  readonly #radioSongs = new WeakSet<object>()
  readonly #artists = new WeakMap<object, string | null>()
  readonly #recent = recentTitles()
  #player: DisTube | null = null

  constructor(deps: { extraction: Extractor; stream: StreamResolver; logger: Logger }) {
    super()
    this.#extraction = deps.extraction
    this.#stream = deps.stream
    this.#logger = deps.logger
  }

  // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/core/DisTubeHandler.ts#L120-L124): distube sends a HEAD request to a link no plugin validates; every link validates, so none is requested unvetted. Goes when distube skips that request.
  override validate(): boolean {
    return true
  }

  override init(distube: DisTube): void {
    super.init(distube)
    this.#player = distube
  }

  override async getRelatedSongs(song: RelatedSeed): Promise<Array<Song>> {
    if (song.id === undefined || song.id === '') {
      return []
    }

    try {
      const info = infoRecord(
        await this.#extraction.json(
          `https://www.youtube.com/watch?v=${song.id}&list=RD${song.id}`,
          ['--flat-playlist', '--playlist-end', String(RELATED_FETCH_LIMIT)],
        ),
      )
      const heard = this.#heard(song)
      const playable = recordsOf(info.entries).filter(
        (entry) => idOf(entry) !== null && idOf(entry) !== song.id && !isLiveInfo(entry),
      )
      const fresh = playable.filter((entry) => !sameSong(stringOf(entry, 'title') ?? '', heard))

      // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/struct/Queue.ts#L402-L411): distube plays the first related entry whose id has not played and offers no way to choose; fresh titles go first. Goes when distube lets a plugin choose.
      return [...fresh, ...playable.filter((entry) => !fresh.includes(entry))].map((entry) =>
        this.buildSong(entry, {}, true),
      )
    } catch (error) {
      this.#logger.error('music.related_failed', error)

      return []
    }
  }

  #heard(song: RelatedSeed): Set<string> {
    const guildId = song.member?.guild.id
    const queued = guildId === undefined ? [] : (this.#player?.getQueue(guildId)?.songs ?? [])
    const titles = [
      song.name,
      ...(guildId === undefined ? [] : this.#recent.of(guildId)),
      ...queued.flatMap((entry) => [
        entry.name,
        entry.stream.playFromSource ? undefined : entry.stream.song?.name,
      ]),
    ]

    return new Set(titles.flatMap((title) => (title === undefined ? [] : titleKeys(title))))
  }

  override async searchSong<T>(query: string, options: ResolveOptions<T>): Promise<Song<T> | null> {
    const songShelfUrl = `https://music.youtube.com/search?${new URLSearchParams({ q: query }).toString()}#songs`
    const shelfSong = await this.#firstEntry(songShelfUrl, ['--playlist-end', '1']).catch(
      (error: unknown) => {
        this.#logger.warn('music.song_search_failed', { error: errorMessage(error) })

        return undefined
      },
    )
    const first = shelfSong ?? (await this.#firstEntry(`ytsearch1:${query}`, ['--no-playlist']))

    return first ? this.buildSong(first, options) : null
  }

  async #firstEntry(url: string, flags: ReadonlyArray<string>): Promise<JsonRecord | undefined> {
    return recordsOf(infoRecord(await this.#extraction.json(url, flags)).entries)[0]
  }

  override async resolve<T>(
    url: string,
    options: ResolveOptions<T>,
  ): Promise<Song<T> | Playlist<T>> {
    assertYoutubeUrl(url)

    const info = infoRecord(
      await this.#extraction.json(url, [
        '--flat-playlist',
        '--playlist-end',
        String(MAX_PLAYLIST_SONGS),
      ]),
    )

    if (info._type === 'playlist') {
      const entries = recordsOf(info.entries).filter((entry) => idOf(entry) !== null)

      if (entries.length === 0) {
        throw new Error('The playlist is empty.')
      }

      const playable = entries.filter((entry) => !isLiveInfo(entry))

      if (playable.length === 0) {
        throw liveError()
      }

      if (playable.length < entries.length) {
        this.#logger.info('music.playlist_live_skipped', {
          skipped: entries.length - playable.length,
        })
      }

      const playlistSize = numberOf(info, 'playlist_count') ?? entries.length

      if (playlistSize > MAX_PLAYLIST_SONGS) {
        this.#logger.info('music.playlist_capped', { size: playlistSize, max: MAX_PLAYLIST_SONGS })
      }

      return new Playlist<T>(
        {
          source: stringOf(info, 'extractor') ?? 'youtube',
          songs: playable
            .slice(0, MAX_PLAYLIST_SONGS)
            .map((entry) => this.buildSong(entry, options)),
          ...presentFields({
            id: idOf(info) ?? undefined,
            name: stringOf(info, 'title') ?? undefined,
            url: stringOf(info, 'webpage_url') ?? undefined,
            thumbnail: thumbnailOf(info),
          }),
        },
        options,
      )
    }

    if (isLiveInfo(info)) {
      throw liveError()
    }

    return this.buildSong(info, options)
  }

  override async getStreamURL<T>(song: Song<T>): Promise<string> {
    if (song.isLive) {
      throw liveError()
    }

    const guildId = song.member?.guild.id

    if (guildId !== undefined && song.name !== undefined) {
      this.#recent.add(guildId, song.name)
    }

    return this.#stream.playableUrl(song)
  }

  buildSong<T>(info: JsonRecord, options: ResolveOptions<T>, fromRadio = false): Song<T> {
    const live = isLiveInfo(info)

    this.#stream.remember(idOf(info), info.formats)

    const song = new Song<T>(
      {
        plugin: this,
        source: stringOf(info, 'extractor') ?? 'youtube',
        playFromSource: true,
        id: idOf(info) ?? '',
        isLive: live,
        ...presentFields({
          name: stringOf(info, 'title') ?? stringOf(info, 'fulltitle') ?? undefined,
          url: songUrlOf(info),
          thumbnail: thumbnailOf(info),
          duration: live ? 0 : numberOf(info, 'duration'),
        }),
        uploader: presentFields({ name: stringOf(info, 'uploader') ?? undefined }),
        ageRestricted: (numberOf(info, 'age_limit') ?? 0) >= 18,
      },
      options,
    )

    if (fromRadio) {
      this.#radioSongs.add(song)
    }

    this.#artists.set(song, artistOf(info))

    return song
  }

  trackOf(song: Song): Track {
    const fromRadio = this.#radioSongs.has(song)
    const artist = this.#artists.has(song) ? this.#artists.get(song) : song.uploader.name

    return {
      id: song.id,
      title: song.name ?? song.url ?? 'Unknown song',
      url: song.url ?? '',
      durationSeconds: song.isLive ? 0 : song.duration,
      isLive: Boolean(song.isLive),
      thumbnail: song.thumbnail ?? null,
      requestedBy: song.member?.displayName ?? null,
      requesterId: fromRadio ? null : (song.member?.id ?? null),
      artist: artist === undefined || artist === null || artist === '' ? null : artist,
      fromRadio,
    }
  }
}
