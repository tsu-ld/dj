import { PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../messages.js'
import { ActionError, defineAction } from './action.js'

// The tool stays model-callable, but the channel comes from the person's own
// mention: the model cannot point the bot at a channel nobody named.
function mentionedChannels(message) {
  return [...(message?.mentions?.channels?.values() ?? [])]
}

export const setChannel = defineAction({
  name: 'set_channel',
  description: 'Set the text channel where the bot listens. Use it only when the user\'s own message mentions exactly one channel for the bot.',
  tool: true,
  route: false,
  ack: false,
  confirm: ({ channelId }) => MESSAGES.textChannelConfigured(`<#${channelId}>`),
  run: async (_args, context) => {
    if (!context.member?.permissions.has(PermissionFlagsBits.ManageChannels))
      throw new ActionError(MESSAGES.channelConfigurePermission, { say: true })

    const channels = mentionedChannels(context.message)

    if (channels.length !== 1)
      throw new ActionError(MESSAGES.channelExplicit, { say: true })

    const channel = await context.message.guild.channels.fetch(channels[0].id).catch(() => null)

    if (!channel || !channel.isTextBased() || !('guild' in channel))
      throw new ActionError(MESSAGES.textChannelInvalid, { say: true })

    const me = context.message.guild.members.me
    const permissions = me ? channel.permissionsFor(me) : null
    const isThread = typeof channel.isThread === 'function' && channel.isThread()
    const required = isThread
      ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads]
      : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]

    if ((isThread && (channel.archived || channel.locked)) || !permissions?.has(required))
      throw new ActionError(MESSAGES.textChannelPermissions, { say: true })

    await context.store.updateGuild(context.guildId, { textChannelId: channel.id })
    console.info(`[Config] Text channel set to: ${channel.name} (${channel.id})`)

    return { channelId: channel.id, channelName: channel.name }
  },
})
