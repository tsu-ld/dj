import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.js'
import { runTool } from '../tools.js'

const guildId = '123456789012345678'

test('an unknown tool is reported to the model', async () => {
  expect(await runTool('nope', {}, { guildId })).toEqual({ error: 'there is no tool called nope' })
})

test('a queue tool without a queue is reported instead of throwing', async () => {
  expect(await runTool('skip', {}, { guildId })).toEqual({ error: 'nothing is playing right now' })
})

test('an action error becomes a tool result and does not write settings', async () => {
  let writes = 0
  const result = await runTool('set_persona', { persona: 'x' }, {
    guildId,
    member: { permissions: { has: () => false } },
    store: {
      updateGuild: async () => {
        writes++
      },
    },
  })

  expect(result).toEqual({ error: MESSAGES.personaPermission })
  expect(writes).toBe(0)
})
