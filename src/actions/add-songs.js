import { playIntroIfFirstJoin } from '../music/intro.js'
import { player, ytDlpPlugin } from '../music/player.js'
import { withAnnouncementsSuppressed } from '../music/queue-events.js'
import { ActionError, defineAction } from './action.js'

const MAX_SONGS_PER_REQUEST = 10

// All searches run in parallel, then the resolved playlist is added with a
// single play() so the queue keeps the requested order and only one add event
// fires. A burst of searches is a real YouTube 403 risk, but ten at once is
// what a request like "poneme una playlist" means, and the throttle seen so
// far only hit googlevideo media URLs, not search queries.
async function queueSongs(songs, context) {
  const requested = Array.isArray(songs) ? songs : []
  const wanted = requested.slice(0, MAX_SONGS_PER_REQUEST)

  if (!wanted.length)
    throw new ActionError('no songs were given')

  const { voiceChannel, textChannel, member } = context

  if (!voiceChannel)
    throw new ActionError('they are not in a voice channel, so there is nowhere to play')

  await playIntroIfFirstJoin(voiceChannel)

  const resolved = (await Promise.all(
    wanted.map(song => ytDlpPlugin.searchSong(song, { member }).catch((error) => {
      console.error(`[DJ] Could not find "${song}":`, error)

      return null
    })),
  )).filter(Boolean)

  if (!resolved.length)
    throw new ActionError('none of those songs were found')

  const playlist = await player.createCustomPlaylist(resolved, { member })

  await withAnnouncementsSuppressed(voiceChannel.guild.id, () => player.play(voiceChannel, playlist, { textChannel, member }))

  return {
    queued: resolved.length,
    missing: requested.length - resolved.length,
    first_added: resolved[0].name,
  }
}

export const addSongs = defineAction({
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
  route: false,
  run: ({ songs }, context) => queueSongs(songs, context),
})
