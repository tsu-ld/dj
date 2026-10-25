import { defineAction } from './action.js'

export const shuffle = defineAction({
  name: 'shuffle',
  description: 'Shuffle the songs that are waiting in the queue.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    await queue.shuffle()

    return { shuffled: queue.songs.length }
  },
})
