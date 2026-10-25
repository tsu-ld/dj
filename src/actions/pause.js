import { defineAction } from './action.js'

export const pause = defineAction({
  name: 'pause',
  description: 'Pause the music that is playing.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    if (!queue.paused)
      await queue.pause()

    return { paused: queue.paused }
  },
})
