import { MESSAGES } from '../messages/en.js'
import { playIntroIfFirstJoin } from '../music/intro.js'
import { player } from '../music/player.js'
import { capQueue, MAX_QUEUE_SIZE, queueRoom } from '../music/queue-controls.js'
import { voiceChannelProblem } from '../music/voice.js'
import { assertSupportedMusicUrl } from '../music/yt-dlp-policy.js'
import { ActionError, defineAction } from './action.js'

export const query = defineAction({
  name: 'query',
  description: 'Play a song or playlist from a link or search text.',
  tool: false,
  route: false,
  ack: false,
  run: async ({ query: text }, context) => {
    const problem = voiceChannelProblem(context.voiceChannel, context.message.guild)

    if (problem)
      throw new ActionError(problem)

    try {
      assertSupportedMusicUrl(text)
    }
    catch (error) {
      if (error.code !== 'UNSUPPORTED_URL')
        throw error

      throw new ActionError(MESSAGES.unsupportedUrl, { say: true })
    }

    if (queueRoom(player.getQueue(context.guildId)) === 0)
      throw new ActionError(MESSAGES.queueFull(MAX_QUEUE_SIZE), { say: true })

    await playIntroIfFirstJoin(context.voiceChannel)

    const before = player.getQueue(context.guildId)?.songs.length ?? 0

    try {
      await player.play(context.voiceChannel, text, {
        textChannel: context.textChannel,
        member: context.member,
      })
    }
    catch (error) {
      if (!player.getQueue(context.guildId))
        await context.message.guild?.members.me?.voice?.disconnect()

      if (error.errorCode === 'NO_RESULT' || error.errorCode === 'CANNOT_RESOLVE_SONG')
        throw new ActionError(MESSAGES.noResult)

      if (error.errorCode === 'LIVE_UNSUPPORTED')
        throw new ActionError(MESSAGES.liveUnsupported, { say: true })

      console.error('[Music] Play error:', error)
      throw new ActionError(MESSAGES.playbackError, { say: true })
    }

    const queue = player.getQueue(context.guildId)
    const added = queue ? queue.songs.length - before : 0
    const removed = queue ? capQueue(queue) : 0

    if (removed > 0)
      throw new ActionError(MESSAGES.playlistCapped(added - removed, added), { say: true })
  },
})
