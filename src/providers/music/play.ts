import type { DisTube, Song } from 'distube'
import type { KeyedQueue } from '../../core/async.ts'
import type { Logger } from '../../core/logger.ts'
import type { AudioOverMusic, PlayRequest, PlayResult } from '../../ports/music.ts'
import type { MusicCatalog } from './catalog.ts'
import type { PlayCapture } from './types.ts'
import { UserError } from '../../core/errors.ts'
import { MAX_QUEUE_SIZE } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { assertSupportedMusicUrl, PolicyError } from './policy.ts'
import { capQueue, errorCodeOf, queueRoom } from './queue.ts'
import { voiceChannelProblem } from './voice.ts'

export function musicPlay(deps: {
  player: DisTube
  catalog: MusicCatalog
  audio: AudioOverMusic
  mutations: KeyedQueue
  plays: Map<string, PlayCapture>
  logger: Logger
}): (request: PlayRequest) => Promise<PlayResult> {
  const { player, catalog, audio, mutations, plays, logger } = deps

  function mapPlayFailure(error: unknown, request: PlayRequest, text: boolean): UserError {
    if (error instanceof UserError)
      return error

    const code = errorCodeOf(error)

    if (code === 'NO_RESULT' || code === 'CANNOT_RESOLVE_SONG')
      return new UserError(MESSAGES.noResult)

    if (code === 'LIVE_UNSUPPORTED')
      return new UserError(MESSAGES.liveUnsupported)

    if (error instanceof PolicyError) {
      if (error.code === 'LIVE_UNSUPPORTED')
        return new UserError(MESSAGES.liveUnsupported)

      if (error.code === 'UNSUPPORTED_URL')
        return new UserError(MESSAGES.unsupportedUrl)
    }

    logger.error('music.play_failed', error, { guildId: request.voiceChannel.guild.id })

    // A text request that never created a queue leaves the bot sitting alone in
    // voice: a failed direct query disconnects. A dj batch keeps its connection.
    if (text && !player.getQueue(request.voiceChannel.guild.id))
      void request.voiceChannel.guild.members.me?.voice?.disconnect()

    return new UserError(MESSAGES.playbackError)
  }

  function assertSupportedText(text: string): void {
    try {
      assertSupportedMusicUrl(text)
    }
    catch (error) {
      if (error instanceof PolicyError)
        throw new UserError(MESSAGES.unsupportedUrl)

      throw error
    }
  }

  return async function play(request: PlayRequest): Promise<PlayResult> {
    const guildId = request.voiceChannel.guild.id

    return mutations.run(guildId, async () => {
      const problem = voiceChannelProblem(request.voiceChannel)

      if (problem !== null)
        throw new UserError(problem)

      const text = request.kind === 'text' && typeof request.value === 'string' ? request.value : null
      const tracks: readonly string[] = request.kind === 'tracks' && Array.isArray(request.value)
        ? request.value.filter((entry): entry is string => typeof entry === 'string')
        : []

      if (text === null && tracks.length === 0)
        throw new UserError(MESSAGES.noResult)

      if (text !== null)
        assertSupportedText(text)

      if (queueRoom(player.getQueue(guildId)) === 0)
        throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

      await audio.playWelcome(request.voiceChannel)

      const capture: PlayCapture = { announce: request.announce, playlist: null }
      const before = player.getQueue(guildId)?.songs.length ?? 0

      plays.set(guildId, capture)

      try {
        if (text !== null) {
          await player.play(request.voiceChannel, text, {
            textChannel: request.textChannel,
            member: request.member,
          })
        }
        else {
          const wanted = tracks.slice(0, queueRoom(player.getQueue(guildId)))

          if (wanted.length === 0)
            throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

          // All searches run in parallel, then the resolved playlist is added
          // with a single play() so the queue keeps the requested order and only
          // one add event fires.
          const resolved = (await Promise.all(wanted.map(async query => catalog.searchSong(query, { member: request.member })
            .catch((error: unknown) => {
              logger.error('music.search_failed', error, { query })

              return null
            })))).filter((song): song is Song => song !== null)

          if (resolved.length === 0)
            throw new UserError(MESSAGES.noResult)

          const playlist = await player.createCustomPlaylist(resolved, { member: request.member })

          await player.play(request.voiceChannel, playlist, {
            textChannel: request.textChannel,
            member: request.member,
          })
        }
      }
      catch (error) {
        throw mapPlayFailure(error, request, text !== null)
      }
      finally {
        plays.delete(guildId)
      }

      const queue = player.getQueue(guildId)
      const added = queue ? Math.max(queue.songs.length - before, 0) : 0
      const dropped = queue ? capQueue(queue) : 0
      const firstSong = queue?.songs[before]

      return {
        added,
        first: firstSong ? catalog.trackOf(firstSong).title : null,
        playlist: capture.playlist,
        dropped,
        total: queue?.songs.length ?? 0,
      }
    })
  }
}
