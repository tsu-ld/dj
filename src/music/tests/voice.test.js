import { expect, test } from 'bun:test'
import { ChannelType } from 'discord.js'
import { MESSAGES } from '../../messages.js'
import { voiceChannelProblem } from '../voice.js'

const guild = { members: { me: { id: 'bot' } } }

function voiceChannel({ type = ChannelType.GuildVoice, permissions = { has: () => true } } = {}) {
  return { type, permissionsFor: () => permissions }
}

test('playing without a voice channel is rejected', () => {
  expect(voiceChannelProblem(null, guild)).toBe(MESSAGES.joinVoiceChannel)
})

test('a stage channel needs speaker permission', () => {
  expect(voiceChannelProblem(voiceChannel({ type: ChannelType.GuildStageVoice }), guild)).toBe(MESSAGES.stageChannelPermissions)
})

test('a channel where the bot cannot connect and speak is rejected', () => {
  expect(voiceChannelProblem(voiceChannel({ permissions: { has: () => false } }), guild)).toBe(MESSAGES.botPermissions)
  expect(voiceChannelProblem(voiceChannel({ permissions: null }), guild)).toBe(MESSAGES.botPermissions)
})

test('a regular voice channel with permissions is fine', () => {
  expect(voiceChannelProblem(voiceChannel(), guild)).toBeNull()
})

test('the guild defaults to the voice channel guild', () => {
  const channel = { ...voiceChannel(), guild }

  expect(voiceChannelProblem(channel)).toBeNull()
})
