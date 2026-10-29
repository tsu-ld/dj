import type { CommandData, CommandSpec } from './spec.ts'
import { UserError } from '../core/errors.ts'
import { MAX_QUEUE_SIZE, MAX_SONGS_PER_REQUEST, queueRoom } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { EMPTY_PARAMETERS } from './parameters.ts'

const NO_SONGS = 'no songs were given'

export const addSongs: CommandSpec = {
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
    const voiceChannel = context.voiceChannel

    if (!songs.length)
      throw new UserError(NO_SONGS)

    if (!voiceChannel)
      throw new UserError(MESSAGES.joinVoiceChannel)

    const room = queueRoom(context.queue?.size ?? 0)

    if (room === 0)
      throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

    const wanted = songs.slice(0, Math.min(MAX_SONGS_PER_REQUEST, room))
    const result = await context.services.music.play({
      kind: 'tracks',
      value: wanted,
      member: context.member,
      voiceChannel,
      textChannel: context.textChannel,
      announce: false,
    })

    return {
      queued: result.added,
      missing: Math.max(wanted.length - result.added, 0),
      skipped_for_room: songs.length - wanted.length,
      first_added: result.first,
    }
  },
}

export const query: CommandSpec = {
  name: 'query',
  description: 'Play a song or playlist from a link or search text.',
  parameters: EMPTY_PARAMETERS,
  modelTool: false,
  fastRoute: false,
  requiresVoice: true,
  ack: false,
  confirm: cappedPlaylist,
  async run(args, context) {
    const text = typeof args.query === 'string' ? args.query : ''
    const voiceChannel = context.voiceChannel

    if (!voiceChannel)
      throw new UserError(MESSAGES.joinVoiceChannel)

    if (queueRoom(context.queue?.size ?? 0) === 0)
      throw new UserError(MESSAGES.queueFull(MAX_QUEUE_SIZE))

    const result = await context.services.music.play({
      kind: 'text',
      value: text,
      member: context.member,
      voiceChannel,
      textChannel: context.textChannel,
      announce: true,
    })

    return { added: result.added, dropped: result.dropped }
  },
}

function cappedPlaylist(data: CommandData): string | null {
  const added = data?.added
  const dropped = data?.dropped

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
