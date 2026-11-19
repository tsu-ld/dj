import type { ResolveOptions } from 'distube'
import type { Logger } from '../../core/logger.ts'
import { InfoExtractorPlugin, Playlist, Song } from 'distube'
import { UserError } from '../../core/errors.ts'
import { isRecord } from '../../core/json.ts'
import { MAX_PLAYLIST_SONGS } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'

// The Spotify package ships CommonJS only, so it builds its songs and playlists
// from the SDK's CommonJS copy while the engine runs the ESM copy. The engine's
// `instanceof Playlist` then fails, it queues the whole playlist as one song with
// no stream, and the first play throws on `song.stream.playFromSource`. This
// plugin reads what the package returns and rebuilds it in the engine's classes.
export interface MetadataSource {
  validate: (url: string) => boolean | Promise<boolean>
  resolve: (url: string, options: object) => Promise<unknown>
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export class MetadataCatalog extends InfoExtractorPlugin {
  readonly #source: MetadataSource
  readonly #logger: Logger

  constructor(deps: { source: MetadataSource, logger: Logger }) {
    super()
    this.#source = deps.source
    this.#logger = deps.logger
  }

  override validate(url: string): boolean | Promise<boolean> {
    return this.#source.validate(url)
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    const raw = await this.#source.resolve(url, {})

    if (!isRecord(raw) || !Array.isArray(raw.songs)) {
      const song = this.#songOf(raw, options)

      if (song === null)
        throw new UserError(MESSAGES.noResult)

      return song
    }

    const songs = raw.songs
      .map((entry: unknown) => this.#songOf(entry, options))
      .filter((song): song is Song<T> => song !== null)

    if (songs.length === 0)
      throw new UserError(MESSAGES.noResult)

    if (songs.length > MAX_PLAYLIST_SONGS)
      this.#logger.info('music.playlist_capped', { size: songs.length, max: MAX_PLAYLIST_SONGS })

    return new Playlist<T>({
      source: 'spotify',
      songs: songs.slice(0, MAX_PLAYLIST_SONGS),
      name: textOf(raw.name),
      url: textOf(raw.url),
      thumbnail: textOf(raw.thumbnail),
    }, options)
  }

  override createSearchQuery<T>(song: Song<T>): string {
    return [song.name, song.uploader.name].filter(Boolean).join(' ')
  }

  override getRelatedSongs(): Song[] {
    return []
  }

  #songOf<T>(raw: unknown, options: ResolveOptions<T>): Song<T> | null {
    const id = isRecord(raw) ? textOf(raw.id) : undefined

    if (!isRecord(raw) || id === undefined)
      return null

    const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? raw.duration : 0
    const uploader = isRecord(raw.uploader) ? raw.uploader : {}

    return new Song<T>({
      plugin: this,
      source: 'spotify',
      // the engine searches the catalog for a playable copy when it starts
      playFromSource: false,
      id,
      name: textOf(raw.name),
      url: textOf(raw.url),
      thumbnail: textOf(raw.thumbnail),
      duration,
      uploader: { name: textOf(uploader.name) },
    }, options)
  }
}
