import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { fakeContext, fakeMember, fakeMessage, fakeSettings, fakeUi, log } from './fakes.ts'

const textChannel = {
  id: '456',
  name: 'music',
  isTextBased: () => true,
  isThread: () => false,
  archived: false,
  locked: false,
  permissionsFor: () => ({ has: () => true }),
}

const otherChannel = { ...textChannel, id: '789', name: 'general' }

function message(content: string, channels: readonly (typeof textChannel)[] = []): ReturnType<typeof fakeMessage> {
  return fakeMessage({
    content,
    channels,
    fetchChannel: id => [textChannel, otherChannel].find(channel => channel.id === id) ?? null,
  })
}

const bus = commandBus({ specs: commands, logger: log })

describe('set_persona', () => {
  test('permissions gate persona changes before the message intent', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_persona', { persona: 'un dj' }, fakeContext({
      guildId: 'g1',
      member: fakeMember({ allowed: false }),
      message: message('<@999> hola'),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.personaPermission })
    expect(settings.updates).toEqual([])
  })

  test('a persona change needs the intent in the user message', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_persona', { persona: 'un dj' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> hola'),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.personaExplicit })
    expect(settings.updates).toEqual([])
  })

  test('a persona change is accepted when the user asks for it', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_persona', { persona: '  un dj  ' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> sé un dj'),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'ok', data: { persona: 'un dj' } })
    expect(settings.updates).toEqual([['g1', { persona: 'un dj' }]])
  })

  test('a persona change accepts a comma after the mention and english', async () => {
    for (const content of ['<@999>, sé un dj', '<@999> speak like a pirate', '<@999> talk like a cumbiero']) {
      const settings = fakeSettings()

      await bus.run('set_persona', { persona: 'un dj' }, fakeContext({
        guildId: 'g1',
        member: fakeMember(),
        message: message(content),
        services: { settings },
      }))

      expect(settings.updates).toHaveLength(1)
    }
  })

  test('a word that only starts like the persona trigger is not enough', async () => {
    const outcome = await bus.run('set_persona', { persona: 'un dj' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> seguí con la música'),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.personaExplicit })
  })

  test('an empty persona asks for a real one', async () => {
    const outcome = await bus.run('set_persona', { persona: '   ' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> sé un dj'),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.personaUsage })
  })

  test('a persona longer than the limit is refused', async () => {
    const outcome = await bus.run('set_persona', { persona: 'x'.repeat(501) }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> sé un dj'),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.personaTooLong(500) })
  })
})

describe('set_channel', () => {
  test('permissions gate channel changes before the mention', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_channel', { channelId: textChannel.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember({ allowed: false }),
      message: message('<@999> escuchá en music'),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.channelConfigurePermission })
    expect(settings.updates).toEqual([])
  })

  test('a channel change without a mention is rejected', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_channel', { channelId: textChannel.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message('<@999> escuchá en music'),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.channelExplicit })
    expect(settings.updates).toEqual([])
  })

  test('a channel change uses the single mentioned channel, not the model argument', async () => {
    const settings = fakeSettings()
    const ui = fakeUi()

    const outcome = await bus.run('set_channel', { channelId: otherChannel.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message(`<@999> escuchá en <#${textChannel.id}>`, [textChannel]),
      services: { settings },
      ui,
    }))

    expect(outcome).toEqual({ kind: 'ok', data: { channelId: textChannel.id, channelName: textChannel.name } })
    expect(settings.updates).toEqual([['g1', { textChannelId: textChannel.id }]])
    expect(ui.replies).toEqual([MESSAGES.textChannelConfigured(`<#${textChannel.id}>`)])
  })

  test('a channel where the bot cannot read or send is rejected', async () => {
    const blocked = { ...textChannel, permissionsFor: () => ({ has: () => false }) }
    const settings = fakeSettings()

    const outcome = await bus.run('set_channel', { channelId: blocked.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: `<@999> escuchá en <#${blocked.id}>`, channels: [blocked], fetchChannel: () => blocked }),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.textChannelPermissions })
    expect(settings.updates).toEqual([])
  })

  test('a channel change with two mentions is rejected', async () => {
    const outcome = await bus.run('set_channel', { channelId: textChannel.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: message(`<@999> escuchá en <#${textChannel.id}> o <#${otherChannel.id}>`, [textChannel, otherChannel]),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.channelExplicit })
  })

  test('a mentioned channel that cannot be fetched is rejected', async () => {
    const outcome = await bus.run('set_channel', { channelId: '456' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: '<@999> escuchá en <#456>', channels: [{ id: '456' }], fetchChannel: () => null }),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.textChannelInvalid })
  })

  test('an archived or locked thread is rejected', async () => {
    const thread = { ...textChannel, isThread: () => true, archived: true }

    const outcome = await bus.run('set_channel', { channelId: thread.id }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: `<@999> escuchá en <#${thread.id}>`, channels: [thread], fetchChannel: () => thread }),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.textChannelPermissions })
  })
})
