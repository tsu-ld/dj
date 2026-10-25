import { clearQueue } from '../music/queue-controls.js'
import { defineAction } from './action.js'

export const clear = defineAction({
  name: 'clear',
  description: 'Stop the music, clear the queue and leave the voice channel.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    await clearQueue(queue)

    return { cleared: true }
  },
})
