import type { GuildTextBasedChannel } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import type { CommandData, VoiceSpec } from './spec.ts'
import { errorMessage, UserError } from '../core/errors.ts'
import { MAX_QUEUE_SIZE, MAX_SONGS_PER_REQUEST, queueRoom } from '../limits.ts'
import { MESSAGES } from '../messages.ts'

const NO_SONGS = 'no songs were given'
const TYPING_REFRESH_MS = 8_000
const TYPING_MAX_MS = 60_000

// Discord drops a typing indicator after ten seconds.
function keepTyping(channel: GuildTextBasedChannel, logger: Logger): () => void {
  let refresh: ReturnType<typeof setInterval> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null

  const send = (): void => {
    void channel.sendTyping().catch((error: unknown) => {
      logger.debug('command.typing_failed', { error: errorMessage(error) })
    })
  }

  const stop = (): void => {
    if (refresh !== null) {
      clearInterval(refresh)
      refresh = null
    }

    if (deadline !== null) {
      clearTimeout(deadline)
      deadline = null
    }
  }

  send()
  refresh = setInterval(send, TYPING_REFRESH_MS)
  deadline = setTimeout(stop, TYPING_MAX_MS)

  return stop
}

export const addSongs: VoiceSpec = {
  name: 'add_songs',
  description: 'Add songs to the queue. Every entry is searched on YouTube, so write each one as "Artist - Title". When the request is a mood, a genre or an era rather than a named song, choose the songs yourself.',
  parameters: {
    type: 'object',
    properties: {
      songs: {
        type: 'array',
        items: { type: 'string' },
        description: `Up to ${MAX_SONGS_PER_REQUEST} songs, in the order they should play.`,
      },
    },
    required: ['songs'],
  },
  fastRoute: false,
  requiresVoice: true,
  async run(args, context) {
    const songs = readSongs(args.songs)

    if (!songs.length)
      throw new UserError(NO_SONGS)

    const room = queueRoom(context.services.music.view(context.guildId)?.size ?? 0)

    if (room === 0)
      throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

    const wanted = songs.slice(0, Math.min(MAX_SONGS_PER_REQUEST, room))
    const result = await context.services.music.play({
      kind: 'tracks',
      value: wanted,
      member: context.member,
      voiceChannel: context.voiceChannel,
      textChannel: context.textChannel,
    })

    return {
      queued: result.added,
      missing: Math.max(wanted.length - result.added, 0),
      skipped_for_room: songs.length - wanted.length,
      first_added: result.first,
    }
  },
}

export const query: VoiceSpec = {
  name: 'query',
  description: 'Play a song or playlist from a link or search text.',
  modelTool: false,
  fastRoute: false,
  requiresVoice: true,
  confirm: cappedPlaylist,
  async run(args, context) {
    const text = args.query

    if (typeof text !== 'string')
      throw new Error('query needs the search text')

    if (queueRoom(context.services.music.view(context.guildId)?.size ?? 0) === 0)
      throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

    const stopTyping = keepTyping(context.textChannel, context.services.logger)

    try {
      const result = await context.services.music.play({
        kind: 'text',
        value: text,
        member: context.member,
        voiceChannel: context.voiceChannel,
        textChannel: context.textChannel,
      })

      return { added: result.added, dropped: result.dropped }
    }
    finally {
      stopTyping()
    }
  },
}

function cappedPlaylist(data: CommandData): string | null {
  const added = data.added
  const dropped = data.dropped

  if (typeof added !== 'number' || typeof dropped !== 'number' || dropped <= 0)
    return null

  return MESSAGES.playlistCapped(added - dropped, added)
}

function readSongs(value: unknown): string[] {
  if (!Array.isArray(value))
    return []

  const items: unknown[] = value

  return items
    .filter((song): song is string => typeof song === 'string')
    .map(song => song.trim())
    .filter(Boolean)
}
