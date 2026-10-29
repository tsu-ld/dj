import type { CommandSpec } from './spec.ts'
import { UserError } from '../core/errors.ts'
import { isPositionInQueue } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { EMPTY_PARAMETERS } from './parameters.ts'

const POSITION = /(?:^|\s)(\d{1,3})(?=\s|$)/

export const queue: CommandSpec = {
  name: 'queue',
  description: 'Show the full queue of songs. Users say: mostrame la cola, qué suena, qué está sonando, cuántos temas quedan, lista, queue.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  ack: false,
  async run(_args, context) {
    const view = context.queue

    if (!view)
      throw new UserError(MESSAGES.nothingPlaying)

    await context.ui.showQueue(view)

    return {}
  },
}

export const remove: CommandSpec = {
  name: 'remove',
  description: 'Remove one song from the queue by its position, where 1 is the song playing right now. Users say: sacá la 3, eliminá la canción 2, remove 4.',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1 },
    },
    required: ['position'],
  },
  requiresQueue: true,
  parse(text, context) {
    const match = POSITION.exec(text)
    const raw = match?.[1]

    if (raw === undefined)
      return null

    const position = Number.parseInt(raw, 10)

    return isPositionInQueue(context.queue?.size ?? 0, position) ? { position } : null
  },
  async run(args, context) {
    const raw = args.position
    const position = typeof raw === 'number' ? raw : Number(raw)

    if (!Number.isInteger(position) || !isPositionInQueue(context.queue?.size ?? 0, position))
      throw new UserError(MESSAGES.removeOutOfRange)

    const removed = await context.services.music.remove(context.guildId, position)

    return { removed }
  },
}

export const clear: CommandSpec = {
  name: 'clear',
  description: 'Stop the music, clear the queue and leave the voice channel. Users say: cortala, limpiá la cola, cortá todo, pará todo, clear, stop the music, stop everything, leave, chau.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    await context.services.music.stop(context.guildId, { resetStation: true })

    return { cleared: true }
  },
}
