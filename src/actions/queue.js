import { showQueue } from '../music/now-playing.js'
import { defineAction } from './action.js'

export const queue = defineAction({
  name: 'queue',
  description: 'Show the full queue of songs.',
  tool: true,
  requiresQueue: true,
  ack: false,
  run: async (args, context) => {
    await showQueue(context.textChannel, context.queue)

    return {}
  },
})
