import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages/en.js'
import { actions, getAction, modelTools, routeOptions } from '../index.js'

test('every action has a unique name, description and schema', () => {
  const names = actions.map(action => action.name)

  expect(new Set(names).size).toBe(names.length)

  for (const action of actions) {
    expect(action.description.length).toBeGreaterThan(0)
    expect(action.parameters.type).toBe('object')
    expect(typeof action.run).toBe('function')
  }
})

test('the model only sees the tools meant for it', () => {
  const names = modelTools.map(tool => tool.function.name)

  expect(names).toContain('add_songs')
  expect(names).toContain('set_persona')
  expect(names).toContain('set_channel')
  expect(names).not.toContain('query')
  expect(names).not.toContain('toggle')
  expect(names).not.toContain('queue')
})

test('the router sees the commands, not the internal tools', () => {
  const names = routeOptions.map(action => action.name)

  expect(names).toContain('skip')
  expect(names).toContain('remove')
  expect(names).not.toContain('add_songs')
  expect(names).not.toContain('set_channel')
  expect(names).not.toContain('query')
  expect(names).not.toContain('toggle')
})

test('actions are looked up by name without a command switch', () => {
  expect(getAction('skip')?.name).toBe('skip')
  expect(getAction('nope')).toBeUndefined()
})

test('remove takes a valid queue position, or asks the dj', () => {
  const remove = getAction('remove')
  const queue = { songs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }

  expect(remove.parse('remove 3', { queue })).toEqual({ position: 3 })
  expect(remove.parse('sacá la 2', { queue })).toEqual({ position: 2 })
  expect(remove.parse('remove 8', { queue })).toBeNull()
  expect(remove.parse('sacá la tercera', { queue })).toBeNull()
  expect(remove.parse('remove it', { queue })).toBeNull()
})

test('admin actions are dj tools, not fast-path routes', () => {
  for (const name of ['set_persona', 'set_channel']) {
    const action = getAction(name)

    expect(action.tool).toBe(true)
    expect(action.route).toBe(false)
  }
})

test('admin actions reject members without the permission', async () => {
  const member = { permissions: { has: () => false } }
  const context = {
    member,
    guildId: 'g1',
    store: { updateGuild: async () => {} },
  }

  await expect(getAction('set_persona').run({ persona: 'x' }, context))
    .rejects
    .toThrow(MESSAGES.personaPermission)
  await expect(getAction('set_channel').run({ channelId: '123' }, context))
    .rejects
    .toThrow(MESSAGES.channelConfigurePermission)
})

test('set_persona stores a trimmed persona for a manager', async () => {
  const updates = []
  const member = { permissions: { has: () => true } }
  const store = { updateGuild: async (guildId, changes) => updates.push([guildId, changes]) }

  const result = await getAction('set_persona').run({ persona: '  un dj  ' }, { member, store, guildId: 'g1' })

  expect(result).toEqual({ persona: 'un dj' })
  expect(updates).toEqual([['g1', { persona: 'un dj' }]])
})

test('set_channel accepts a mention or a bare id and stores the channel', async () => {
  const updates = []
  const member = { permissions: { has: () => true } }
  const store = { updateGuild: async (guildId, changes) => updates.push([guildId, changes]) }
  const channel = { id: '456', name: 'music', guild: {}, isTextBased: () => true, toString: () => '<#456>' }
  const message = { guild: { channels: { fetch: async id => (id === '456' ? channel : null) } } }

  const result = await getAction('set_channel').run(
    { channelId: '<#456>' },
    { member, store, guildId: 'g1', message },
  )

  expect(result).toEqual({ channel })
  expect(updates).toEqual([['g1', { textChannelId: '456' }]])
})

test('set_channel rejects a malformed channel argument', async () => {
  const member = { permissions: { has: () => true } }
  const context = {
    member,
    guildId: 'g1',
    store: { updateGuild: async () => {} },
  }

  await expect(getAction('set_channel').run({ channelId: 'music-456' }, context))
    .rejects
    .toThrow(MESSAGES.textChannelInvalid)
})

test('player actions read the queue from the context, not the arguments', async () => {
  const calls = []
  const queue = {
    id: '123456789012345678',
    songs: [{ name: 'a' }, { name: 'b' }],
    paused: false,
    autoplay: false,
    textChannel: null,
    pause: async () => {
      queue.paused = true
      calls.push('pause')
    },
    resume: async () => {
      queue.paused = false
      calls.push('resume')
    },
    skip: async () => calls.push('skip'),
    shuffle: async () => calls.push('shuffle'),
    stop: async () => calls.push('stop'),
    toggleAutoplay: () => {
      queue.autoplay = !queue.autoplay
      calls.push('radio')
    },
  }
  const context = { queue }

  await getAction('pause').run({}, context)
  expect(queue.paused).toBe(true)

  await getAction('resume').run({}, context)
  expect(queue.paused).toBe(false)

  await getAction('toggle').run({}, context)
  expect(queue.paused).toBe(true)

  await getAction('skip').run({}, context)
  await getAction('shuffle').run({}, context)
  await getAction('radio').run({}, context)
  await getAction('clear').run({}, context)

  expect(queue.autoplay).toBe(true)
  expect(calls).toEqual(['pause', 'resume', 'pause', 'skip', 'shuffle', 'radio', 'stop'])
})
