import type { DisTube, Song } from 'distube'
import type { KeyedQueue } from '../../core/async.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlayRequest, PlayResult } from '../../ports/music.ts'
import type { MusicAudio } from './audio-types.ts'
import type { MusicCatalog } from './catalog.ts'
import { errorMessage, UserError } from '../../core/errors.ts'
import { MAX_QUEUE_SIZE, queueRoom } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { isSupportedMusicUrl, isUrlLike, PolicyError } from './policy.ts'
import { capQueue, errorCodeOf } from './queue.ts'
import { voiceChannelProblem } from './voice.ts'

export function musicPlay(deps: {
  player: DisTube
  catalog: MusicCatalog
  audio: Pick<MusicAudio, 'playWelcome'>
  mutations: KeyedQueue
  logger: Logger
}): (request: PlayRequest) => Promise<PlayResult> {
  const { player, catalog, audio, mutations, logger } = deps

  function mapPlayFailure(error: unknown, request: PlayRequest): UserError {
    if (error instanceof UserError)
      return error

    const code = errorCodeOf(error)

    if (code === 'NO_RESULT' || code === 'CANNOT_RESOLVE_SONG')
      return new UserError(MESSAGES.noResult)

    if (code === 'LIVE_UNSUPPORTED')
      return new UserError(MESSAGES.liveUnsupported)

    if (error instanceof PolicyError && error.code === 'UNSUPPORTED_URL')
      return new UserError(MESSAGES.unsupportedUrl)

    const guildId = request.voiceChannel.guild.id

    logger.error('music.play_failed', error, { guildId })

    // the bot has already joined voice, and the SDK does not leave when play() fails
    if (request.kind === 'text' && !player.getQueue(guildId)) {
      void request.voiceChannel.guild.members.me?.voice?.disconnect().catch((error: unknown) => {
        logger.warn('music.disconnect_failed', { guildId, error: errorMessage(error) })
      })
    }

    return new UserError(MESSAGES.playbackError)
  }

  return async function play(request: PlayRequest): Promise<PlayResult> {
    const guildId = request.voiceChannel.guild.id

    return mutations.run(guildId, async () => {
      const problem = voiceChannelProblem(request.voiceChannel)

      if (problem !== null)
        throw new UserError(problem)

      if (request.kind === 'text' && isUrlLike(request.value) && !isSupportedMusicUrl(request.value))
        throw new UserError(MESSAGES.unsupportedUrl)

      if (queueRoom(player.getQueue(guildId)?.songs.length ?? 0) === 0)
        throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

      await audio.playWelcome(request.voiceChannel)

      const before = player.getQueue(guildId)?.songs.length ?? 0

      try {
        if (request.kind === 'text') {
          await player.play(request.voiceChannel, request.value, {
            textChannel: request.textChannel,
            member: request.member,
          })
        }
        else {
          const wanted = request.value.slice(0, queueRoom(player.getQueue(guildId)?.songs.length ?? 0))

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
        throw mapPlayFailure(error, request)
      }

      const queue = player.getQueue(guildId)
      const added = queue ? Math.max(queue.songs.length - before, 0) : 0
      const dropped = queue ? capQueue(queue) : 0
      const firstSong = queue?.songs[before]

      return {
        added,
        first: firstSong ? catalog.trackOf(firstSong).title : null,
        dropped,
      }
    })
  }
}
