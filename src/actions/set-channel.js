import { PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../messages/en.js'
import { ActionError, defineAction } from './action.js'

export const setChannel = defineAction({
  name: 'set_channel',
  description: 'Set the text channel where the bot listens. Use it only when someone explicitly names a channel for the bot.',
  parameters: {
    type: 'object',
    properties: {
      channelId: { type: 'string', description: 'The id of the text channel where the bot should listen.' },
    },
    required: ['channelId'],
  },
  tool: true,
  route: false,
  ack: false,
  confirm: ({ channel }) => MESSAGES.textChannelConfigured(channel.toString()),
  run: async ({ channelId }, context) => {
    if (!context.member?.permissions.has(PermissionFlagsBits.ManageChannels))
      throw new ActionError(MESSAGES.channelConfigurePermission, { say: true })

    const raw = String(channelId ?? '').trim()
    const match = raw.match(/^(?:<#)?(\d+)>?$/)

    if (!match)
      throw new ActionError(MESSAGES.textChannelInvalid, { say: true })

    const channel = await context.message.guild.channels.fetch(match[1]).catch(() => null)

    if (!channel || !channel.isTextBased() || !('guild' in channel))
      throw new ActionError(MESSAGES.textChannelInvalid, { say: true })

    await context.store.updateGuild(context.guildId, { textChannelId: channel.id })
    console.info(`[Config] Text channel set to: ${channel.name} (${channel.id})`)

    return { channel }
  },
})
