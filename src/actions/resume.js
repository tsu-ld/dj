import { defineAction } from './action.js'

export const resume = defineAction({
  name: 'resume',
  description: 'Resume the music that is paused.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    if (queue.paused)
      await queue.resume()

    return { paused: queue.paused }
  },
})
