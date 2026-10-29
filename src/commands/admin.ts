import type { Channel, Message } from 'discord.js'
import type { CommandContext, CommandData, CommandSpec } from './spec.ts'
import { PermissionFlagsBits } from 'discord.js'
import { UserError } from '../core/errors.ts'
import { MAX_PERSONA_LENGTH } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { EMPTY_PARAMETERS } from './parameters.ts'

const PERSONA_INTENT = /^(?:(?:s[ée]|act[uú]a|habl[aá]|speak|talk)(?=$|[\s,.:;!?])|persona\s*:)/i
const LEADING_MENTION = /^\s*<@!?\d+>\s*[,:;]?\s*/

// The tool stays model-callable, but the channel comes from the person's own
// mention: the model cannot point the bot at a channel nobody named.
function mentionedChannels(message: Message | null): Channel[] {
  return message ? [...message.mentions.channels.values()] : []
}

// The tool stays model-callable, but the person's own message must ask for the
// change: a song title or a model mistake cannot rewrite the persona.
function asksForPersona(message: Message | null): boolean {
  const content = String(message?.content ?? '').replace(LEADING_MENTION, '').trim()

  return PERSONA_INTENT.test(content)
}

function requirePermission(context: CommandContext, permission: bigint, message: string): void {
  if (!context.member.permissions.has(permission))
    throw new UserError(message)
}

function configuredChannel(data: CommandData): string | null {
  const channelId = data?.channelId

  return typeof channelId === 'string' ? MESSAGES.textChannelConfigured(`<#${channelId}>`) : null
}

export const setChannel: CommandSpec = {
  name: 'set_channel',
  description: 'Set the text channel where the bot listens. Use it only when the user\'s own message mentions exactly one channel for the bot.',
  parameters: EMPTY_PARAMETERS,
  modelTool: true,
  fastRoute: false,
  ack: false,
  authorize(context) {
    requirePermission(context, PermissionFlagsBits.ManageChannels, MESSAGES.channelConfigurePermission)
  },
  confirm: configuredChannel,
  async run(_args, context) {
    const message = context.message
    const channels = mentionedChannels(message)
    const target = channels[0]
    const guild = message?.guild

    if (!message || channels.length !== 1 || !target || !guild)
      throw new UserError(channels.length === 1 ? MESSAGES.textChannelInvalid : MESSAGES.channelExplicit)

    const channel = await guild.channels.fetch(target.id).catch(() => null)

    if (!channel || !channel.isTextBased())
      throw new UserError(MESSAGES.textChannelInvalid)

    const me = guild.members.me
    const permissions = me ? channel.permissionsFor(me) : null
    const thread = channel.isThread() ? channel : null
    const required = thread
      ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads]
      : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]

    if ((thread && (thread.archived || thread.locked)) || !permissions?.has(required))
      throw new UserError(MESSAGES.textChannelPermissions)

    await context.services.settings.update(context.guildId, { textChannelId: channel.id })
    context.services.logger.info('discord.channel_configured', { channelId: channel.id, channelName: channel.name })

    return { channelId: channel.id, channelName: channel.name }
  },
}

export const setPersona: CommandSpec = {
  name: 'set_persona',
  description: 'Change the bot\'s permanent personality or way of speaking. Use it only when someone explicitly asks it to talk differently from now on.',
  parameters: {
    type: 'object',
    properties: {
      persona: { type: 'string', description: 'The personality the bot should adopt from now on.' },
    },
    required: ['persona'],
  },
  modelTool: true,
  fastRoute: false,
  authorize(context) {
    requirePermission(context, PermissionFlagsBits.ManageGuild, MESSAGES.personaPermission)
  },
  async run(args, context) {
    if (!asksForPersona(context.message))
      throw new UserError(MESSAGES.personaExplicit)

    const persona = typeof args.persona === 'string' ? args.persona.trim() : ''

    if (!persona)
      throw new UserError(MESSAGES.personaUsage)

    if (persona.length > MAX_PERSONA_LENGTH)
      throw new UserError(MESSAGES.personaTooLong(MAX_PERSONA_LENGTH))

    await context.services.settings.update(context.guildId, { persona })

    return { persona }
  },
}
