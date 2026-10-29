import type { GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { commandBus } from './src/commands/bus.ts'
import { commands } from './src/commands/index.ts'
import { loadConfig } from './src/config.ts'
import { systemClock } from './src/core/clock.ts'
import { UserError } from './src/core/errors.ts'
import { logger } from './src/core/logger.ts'
import { discordClient } from './src/discord/client.ts'
import { djAgent } from './src/dj/conversation.ts'
import { conversationModel } from './src/providers/language-model/index.ts'
import { musicEngine } from './src/providers/music/index.ts'
import { settingsStore } from './src/providers/settings/index.ts'

const ENV_FILE = process.env.E2E_ENV_FILE ?? '/home/tsu/.config/dj/discord.env'

for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const [key, ...rest] = line.trim().split('=')

  if (key !== undefined && key !== '' && rest.length > 0 && !(key in process.env))
    process.env[key] = rest.join('=').trim()
}

function missing(name: string): never {
  console.log(`Missing ${name}. Point it at a guild the bot is in.`)
  process.exit(1)
}

const config = loadConfig()
const GUILD = process.env.E2E_GUILD ?? missing('E2E_GUILD')
const VOICE = process.env.E2E_VOICE ?? missing('E2E_VOICE')
const TEXT = process.env.E2E_TEXT ?? missing('E2E_TEXT')

const log = logger({ level: 'info' })
const client = discordClient(config, log)
const directory = await mkdtemp(join(tmpdir(), 'dj-e2e-'))
const settings = await settingsStore({ path: join(directory, 'guilds.json'), logger: log })
const music = musicEngine({
  client,
  config: config.music,
  logger: log,
  clock: systemClock,
  beforeStream: async () => {},
})
const model = config.language.enabled
  ? conversationModel({ config: config.language, logger: log })
  : null
const bus = commandBus({ specs: commands, logger: log })
const agent = model === null ? null : djAgent({ model, bus, settings, logger: log, clock: systemClock })

const results: Array<[string, string]> = []

function pass(name: string): void {
  results.push(['PASS', name])
  console.log('  PASS:', name)
}

function fail(name: string, message: string): void {
  results.push(['FAIL', name])
  console.log('  FAIL:', name, '-', message)
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

await client.login()

const guild = await client.guilds.fetch(GUILD)
const channels = await guild.channels.fetch()
const voiceChannel = channels.get(VOICE)
const textChannel = channels.get(TEXT)
const me = await guild.members.fetch(client.user?.id ?? '')

if (!voiceChannel?.isVoiceBased()) {
  console.log('NO VOICE CHANNEL', VOICE)
  process.exit(1)
}

if (!textChannel?.isTextBased() || !('guild' in textChannel)) {
  console.log('NO TEXT CHANNEL', TEXT)
  process.exit(1)
}

function audioMs(): number {
  return music.status(GUILD)?.playbackDurationMs ?? 0
}

function currentSong(): string {
  return music.view(GUILD)?.current?.title ?? '(none)'
}

async function playAndProbe(label: string, input: string, ms = 18_000): Promise<void> {
  await music.play({
    kind: 'text',
    value: input,
    member: me,
    voiceChannel: voiceChannel as VoiceBasedChannel,
    textChannel: textChannel as GuildTextBasedChannel,
    announce: false,
  })
  const before = audioMs()

  await wait(ms)

  const duration = audioMs() - before
  const playing = music.status(GUILD)?.state === 'playing'

  duration > 8_000 && playing
    ? pass(label)
    : fail(label, `audio=${duration}ms status=${playing} song=${currentSong()}`)
}

async function cleanup(): Promise<void> {
  await music.stop(GUILD).catch(() => {})
  await wait(2_000)
}

async function fakeContext() {
  return {
    guildId: GUILD,
    member: me,
    voiceChannel: voiceChannel as VoiceBasedChannel,
    textChannel: textChannel as GuildTextBasedChannel,
    message: null,
    settings: settings.get(GUILD),
    queue: music.view(GUILD),
    services: { music, settings, logger: log },
    ui: {
      reply: async () => {},
      error: async () => {},
      ack: async () => {},
      showQueue: async () => {},
    },
  }
}

console.log('== 1. First play and welcome audio ==')

if (me.voice.channelId !== null)
  await me.voice.disconnect()

await wait(2_000)

if (existsSync(new URL('./assets/welcome.mp3', import.meta.url)))
  await playAndProbe('intro does not swallow the first song', 'hipercandombe maquina de hacer pajaros')
else
  console.log('  SKIP: intro does not swallow the first song (assets/welcome.mp3 missing)')

await cleanup()

console.log('== 2. YouTube URL ==')
await playAndProbe('youtube url plays audio', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
await cleanup()

console.log('== 3. Spotify link ==')
await playAndProbe('spotify link plays audio', 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8')
await cleanup()

console.log('== 4. Pause / resume ==')
await music.play({
  kind: 'text',
  value: 'hipercandombe maquina de hacer pajaros',
  member: me,
  voiceChannel,
  textChannel,
  announce: false,
})
await wait(10_000)

await music.pause(GUILD)
const pauseStart = audioMs()

await wait(4_000)

const pauseEnd = audioMs()
const paused = music.status(GUILD)?.state === 'paused'

paused && Math.abs(pauseEnd - pauseStart) < 200
  ? pass('pause stops playback')
  : fail('pause stops playback', `paused=${paused} delta=${pauseEnd - pauseStart}ms`)

await music.resume(GUILD)
await wait(4_000)

const resumeStart = audioMs()

await wait(4_000)

const resumeEnd = audioMs()

resumeEnd - resumeStart > 2_000
  ? pass('resume continues playback')
  : fail('resume continues playback', `delta=${resumeEnd - resumeStart}ms`)
await cleanup()

console.log('== 5. Queue accumulates ==')
await music.play({
  kind: 'text',
  value: 'never gonna give you up rick astley',
  member: me,
  voiceChannel,
  textChannel,
  announce: false,
})
await wait(8_000)
await music.play({
  kind: 'text',
  value: 'hipercandombe maquina de hacer pajaros',
  member: me,
  voiceChannel,
  textChannel,
  announce: false,
})
await wait(8_000)

const size = music.view(GUILD)?.size ?? 0

size >= 2 ? pass(`queue holds ${size} songs`) : fail('queue holds 2 songs', `got ${size}`)

console.log('== 6. Skip changes song ==')
const before = currentSong()

await music.skip(GUILD).catch(() => {})
await wait(6_000)

const after = currentSong()

before !== after ? pass(`skip moved from "${before}" to "${after}"`) : fail('skip changes song', `stuck on "${after}"`)
await cleanup()

console.log('== 7. Clear empties queue ==')
await music.play({
  kind: 'text',
  value: 'hipercandombe maquina de hacer pajaros',
  member: me,
  voiceChannel,
  textChannel,
  announce: false,
})
await wait(8_000)
await music.stop(GUILD, { resetStation: true }).catch(() => {})
await wait(2_000)

music.view(GUILD) === null ? pass('clear empties the queue') : fail('clear empties the queue', 'queue still present')
await cleanup()

console.log('== 8. Leave is clean ==')
await music.play({
  kind: 'text',
  value: 'hipercandombe maquina de hacer pajaros',
  member: me,
  voiceChannel,
  textChannel,
  announce: false,
})
await wait(10_000)
await music.stop(GUILD, { resetStation: true }).catch(() => {})
await wait(4_000)

const stillIn = (await guild.members.fetch(client.user?.id ?? '')).voice.channelId

stillIn === null ? pass('bot leaves voice cleanly') : fail('bot leaves voice cleanly', `still in channel ${stillIn}`)
console.log('  (manual: a human leaving the channel also drops the bot)')

console.log('== 9. DJ request queues and speaks ==')

if (!agent) {
  console.log('  SKIP: dj answers in character (language model not configured)')
}
else {
  try {
    const context = await fakeContext()
    const djReply = await agent.ask({ request: 'poneme algo de rock nacional', context })

    djReply !== null && djReply.length > 5
      ? pass(`dj answered: "${djReply}"`)
      : fail('dj answers in character', `reply=${JSON.stringify(djReply)}`)

    const djQueue = music.view(GUILD)

    djQueue && djQueue.size >= 1 ? pass(`dj queued ${djQueue.size} songs`) : fail('dj queues songs', 'no queue')
    music.status(GUILD)?.state === 'playing' ? pass('dj plays the queue') : fail('dj plays the queue', 'not playing')
  }
  catch (error) {
    fail('dj request', error instanceof UserError ? error.message : String(error))
  }
}

await cleanup()
await music.dispose()

console.log('\n=== RESULTS ===')

let failed = 0

for (const [status, name] of results) {
  console.log(`  ${status}  ${name}`)

  if (status === 'FAIL')
    failed++
}

console.log(failed === 0 ? '=== ALL PASS ===' : `=== ${failed} FAILED ===`)
await client.destroy()
process.exit(failed === 0 ? 0 : 1)
