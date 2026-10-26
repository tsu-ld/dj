import { PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../messages/en.js'
import { ActionError, defineAction } from './action.js'

const MAX_PERSONA_LENGTH = 500
const PERSONA_INTENT = /^(?:(?:s[ée]|act[uú]a|habl[aá]|speak|talk)(?=$|[\s,.:;!?])|persona\s*:)/i
const LEADING_MENTION = /^\s*<@!?\d+>\s*[,:;]?\s*/

// The tool stays model-callable, but the person's own message must ask for the
// change: a song title or a model mistake cannot rewrite the persona.
function asksForPersona(message) {
  const content = String(message?.content ?? '').replace(LEADING_MENTION, '').trim()

  return PERSONA_INTENT.test(content)
}

export const setPersona = defineAction({
  name: 'set_persona',
  description: 'Change the bot\'s permanent personality or way of speaking. Use it only when someone explicitly asks it to talk differently from now on.',
  parameters: {
    type: 'object',
    properties: {
      persona: { type: 'string', description: 'The personality the bot should adopt from now on.' },
    },
    required: ['persona'],
  },
  tool: true,
  route: false,
  run: async ({ persona }, context) => {
    if (!context.member?.permissions.has(PermissionFlagsBits.ManageGuild))
      throw new ActionError(MESSAGES.personaPermission)

    if (!asksForPersona(context.message))
      throw new ActionError(MESSAGES.personaExplicit, { say: true })

    const nextPersona = String(persona ?? '').trim()

    if (!nextPersona)
      throw new ActionError(MESSAGES.personaUsage)

    if (nextPersona.length > MAX_PERSONA_LENGTH)
      throw new ActionError(MESSAGES.personaTooLong(MAX_PERSONA_LENGTH))

    await context.store.updateGuild(context.guildId, { persona: nextPersona })

    return { persona: nextPersona }
  },
})
