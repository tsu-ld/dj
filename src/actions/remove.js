import { MESSAGES } from '../messages/en.js'
import { isPositionInQueue, removeSongAt } from '../music/queue-controls.js'
import { ActionError, defineAction } from './action.js'

export const remove = defineAction({
  name: 'remove',
  description: 'Remove one song from the queue by its position, where 1 is the song playing right now.',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'integer', minimum: 1 },
    },
    required: ['position'],
  },
  requiresQueue: true,
  parse: (text, context) => {
    const match = text.match(/(?:^|\s)(\d{1,3})(?=\s|$)/)

    if (!match)
      return null

    const position = Number.parseInt(match[1], 10)

    return context.queue && isPositionInQueue(context.queue, position) ? { position } : null
  },
  run: async ({ position }, { queue }) => {
    const index = Number(position)

    if (!Number.isInteger(index) || !isPositionInQueue(queue, index))
      throw new ActionError(MESSAGES.removeOutOfRange)

    const removed = queue.songs[index - 1].name
    await removeSongAt(queue, index)

    return { removed }
  },
})
