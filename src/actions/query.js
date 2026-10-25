import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../messages/en.js'
import { playIntroIfFirstJoin } from '../music/intro.js'
import { player } from '../music/player.js'
import { ActionError, defineAction } from './action.js'

// The same checks gate every path into the voice channel: a direct query or
// the dj's own tool calls must not join where the bot cannot speak.
function voiceChannelProblem(voiceChannel, guild) {
  if (!voiceChannel)
    return MESSAGES.joinVoiceChannel

  if (voiceChannel.type === ChannelType.GuildStageVoice)
    return MESSAGES.stageChannelPermissions

  const permissions = voiceChannel.permissionsFor(guild.members.me)

  if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
    return MESSAGES.botPermissions

  return null
}

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

    await playIntroIfFirstJoin(context.voiceChannel)

    try {
      await player.play(context.voiceChannel, text, {
        textChannel: context.textChannel,
        member: context.member,
      })
    }
    catch (error) {
      if (!player.getQueue(context.guildId))
        await context.message.guild.members.me?.voice?.disconnect()

      if (error.errorCode === 'NO_RESULT')
        throw new ActionError(MESSAGES.noResult)

      console.error('[Music] Play error:', error)
      throw new ActionError(MESSAGES.playbackError, { say: true })
    }
  },
})
