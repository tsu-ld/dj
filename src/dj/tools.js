import { ActionError } from '../actions/action.js'
import { getAction, modelTools } from '../actions/index.js'
import { player } from '../music/player.js'

export const DJ_TOOLS = modelTools

export async function runTool(name, args, context) {
  const action = getAction(name)

  if (!action?.tool)
    return { error: `there is no tool called ${name}` }

  // Resolve the queue per call: adding songs creates it, so a later skip in
  // the same conversation must see the new queue.
  const queue = player.getQueue(context.guildId)

  if (action.requiresQueue && !queue)
    return { error: 'nothing is playing right now' }

  try {
    return await action.run(args, { ...context, queue }) ?? { done: name }
  }
  catch (error) {
    if (error instanceof ActionError)
      return { error: error.message }

    throw error
  }
}
