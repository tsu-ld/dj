// Every command schema is a JSON object; commands without arguments share the
// empty one so the model never sees an invented parameter.
export const EMPTY_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}
