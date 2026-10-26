import { expect, test } from 'bun:test'
import { client } from '../client.js'

test('mentions are disabled by default for every message the bot sends', () => {
  expect(client.options.allowedMentions).toEqual({ parse: [], repliedUser: false })
})
