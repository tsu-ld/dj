import { addSongs } from './add-songs.js'
import { clear } from './clear.js'
import { pause } from './pause.js'
import { query } from './query.js'
import { queue } from './queue.js'
import { radio } from './radio.js'
import { remove } from './remove.js'
import { resume } from './resume.js'
import { setChannel } from './set-channel.js'
import { setPersona } from './set-persona.js'
import { shuffle } from './shuffle.js'
import { skip } from './skip.js'
import { toggle } from './toggle.js'

const ACTIONS = [
  addSongs,
  clear,
  pause,
  query,
  queue,
  radio,
  remove,
  resume,
  setChannel,
  setPersona,
  shuffle,
  skip,
  toggle,
]

const actionsByName = new Map(ACTIONS.map(action => [action.name, action]))

function toTool(action) {
  return {
    type: 'function',
    function: {
      name: action.name,
      description: action.description,
      parameters: action.parameters,
    },
  }
}

export const actions = ACTIONS
export const modelTools = ACTIONS.filter(action => action.tool).map(toTool)
export const routeOptions = ACTIONS.filter(action => action.route)

export function getAction(name) {
  return actionsByName.get(name)
}
