export const EMPTY_PARAMETERS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

// Expected, user-facing failures: the router refuses with the message and the
// model gets it back as a tool error instead of a stack trace.
export class ActionError extends Error {
  constructor(message, { say = false } = {}) {
    super(message)
    this.say = say
  }
}

export function defineAction({
  name,
  description,
  parameters = EMPTY_PARAMETERS,
  tool = true,
  route = true,
  requiresQueue = false,
  ack = true,
  parse = () => ({}),
  confirm = null,
  run,
}) {
  return { name, description, parameters, tool, route, requiresQueue, ack, parse, confirm, run }
}
