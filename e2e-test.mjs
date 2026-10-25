import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { Events } from 'distube'
import { client } from './src/discord/client.js'
import { askDj } from './src/dj/ask.js'
import { playIntroIfFirstJoin } from './src/music/intro.js'
import { player } from './src/music/player.js'

const ENV_FILE = process.env.E2E_ENV_FILE ?? '/home/tsu/.config/dj/discord.env'

for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const [key, ...rest] = line.trim().split('=')

  if (key && rest.length && !(key in process.env))
    process.env[key] = rest.join('=').trim()
}

const token = process.env.DISCORD_TOKEN
const GUILD = process.env.E2E_GUILD
const VOICE = process.env.E2E_VOICE
const TEXT = process.env.E2E_TEXT

if (!GUILD || !VOICE || !TEXT) {
  console.log('Missing E2E_GUILD, E2E_VOICE or E2E_TEXT. Point them at a guild the bot is in.')
  process.exit(1)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const results = []

function pass(name) {
  results.push(['PASS', name])
  console.log('  PASS:', name)
}

function fail(name, message) {
  results.push(['FAIL', name])
  console.log('  FAIL:', name, '-', message)
}

player.on(Events.ERROR, error => console.log('  [distube error]', error.message))

await client.login(token)
const guild = await client.guilds.fetch(GUILD)
const channels = await guild.channels.fetch()
const voiceChannel = channels.get(VOICE)
const textChannel = channels.get(TEXT)
const me = await guild.members.fetch(client.user.id)

if (!voiceChannel) {
  console.log('NO VOICE CHANNEL', VOICE)
  process.exit(1)
}

function audioMs() {
  return player.voices.get(GUILD)?.audioPlayer?.state?.playbackDuration ?? 0
}

function currentSong() {
  return player.getQueue(GUILD)?.songs[0]?.name ?? '(none)'
}

async function playAndProbe(label, input, ms = 18000) {
  await player.play(voiceChannel, input, { textChannel, member: me })
  const before = audioMs()
  await wait(ms)
  const duration = audioMs() - before
  const song = currentSong()
  const playing = player.voices.get(GUILD)?.audioPlayer?.state?.status === 'playing'
  duration > 8000 && playing ? pass(label) : fail(label, `audio=${duration}ms status=${playing} song=${song}`)
}

async function cleanup() {
  await player.getQueue(GUILD)?.stop().catch(() => {})
  await wait(2000)
}

console.log('== 1. YouTube search ==')
if (me.voice.channelId)
  await me.voice.disconnect()
await wait(2000)

if (existsSync(new URL('./assets/welcome.mp3', import.meta.url))) {
  await playIntroIfFirstJoin(voiceChannel)
  await playAndProbe('intro does not swallow the first song', 'hipercandombe maquina de hacer pajaros')
}
else {
  console.log('  SKIP: intro does not swallow the first song (assets/welcome.mp3 missing)')
}
await cleanup()

console.log('== 2. YouTube URL ==')
await playAndProbe('youtube url plays audio', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
await cleanup()

console.log('== 3. Spotify link ==')
await playAndProbe('spotify link plays audio', 'https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8')
await cleanup()

console.log('== 4. Pause / resume ==')
await player.play(voiceChannel, 'hipercandombe maquina de hacer pajaros', { textChannel, member: me })
await wait(10000)
const queue = player.getQueue(GUILD)
await queue.pause()
const pauseStart = audioMs()
await wait(4000)
const pauseEnd = audioMs()
queue.paused && Math.abs(pauseEnd - pauseStart) < 200
  ? pass('pause stops playback')
  : fail('pause stops playback', `paused=${queue.paused} delta=${pauseEnd - pauseStart}ms`)
await queue.resume()
await wait(4000)
const resumeStart = audioMs()
await wait(4000)
const resumeEnd = audioMs()
resumeEnd - resumeStart > 2000
  ? pass('resume continues playback')
  : fail('resume continues playback', `delta=${resumeEnd - resumeStart}ms`)
await cleanup()

console.log('== 5. Queue accumulates ==')
await player.play(voiceChannel, 'never gonna give you up rick astley', { textChannel, member: me })
await wait(8000)
await player.play(voiceChannel, 'hipercandombe maquina de hacer pajaros', { textChannel, member: me })
await wait(8000)
const queueLength = player.getQueue(GUILD)?.songs.length ?? 0
queueLength >= 2 ? pass(`queue holds ${queueLength} songs`) : fail('queue holds 2 songs', `got ${queueLength}`)

console.log('== 6. Skip changes song ==')
const before = currentSong()
await player.getQueue(GUILD)?.skip().catch(() => {})
await wait(6000)
const after = currentSong()
before !== after ? pass(`skip moved from "${before}" to "${after}"`) : fail('skip changes song', `stuck on "${after}"`)
await cleanup()

console.log('== 7. Clear empties queue ==')
await player.play(voiceChannel, 'hipercandombe maquina de hacer pajaros', { textChannel, member: me })
await wait(8000)
await player.getQueue(GUILD)?.stop().catch(() => {})
await wait(2000)
!player.getQueue(GUILD) ? pass('clear empties the queue') : fail('clear empties the queue', 'queue still present')
await cleanup()

console.log('== 8. Leave is clean ==')
await player.play(voiceChannel, 'hipercandombe maquina de hacer pajaros', { textChannel, member: me })
await wait(10000)
await player.voices.get(GUILD)?.leave()
await wait(4000)
const stillIn = (await guild.members.fetch(client.user.id)).voice.channelId
!stillIn ? pass('bot leaves voice cleanly') : fail('bot leaves voice cleanly', `still in channel ${stillIn}`)
console.log('  (manual: a human leaving the channel also drops the bot)')

console.log('== 9. DJ request queues and speaks ==')
const fakeMessage = { guildId: GUILD, channelId: TEXT, channel: textChannel, member: me }
const fakeSettings = { persona: null }
const fakeStore = {
  get: () => fakeSettings,
  updateGuild: async () => {},
}

try {
  const djReply = await askDj({
    message: fakeMessage,
    settings: fakeSettings,
    request: 'poneme algo de rock nacional',
    voiceChannel,
    store: fakeStore,
  })
  djReply?.length > 5 ? pass(`dj answered: "${djReply}"`) : fail('dj answers in character', `reply=${JSON.stringify(djReply)}`)
  const djQueue = player.getQueue(GUILD)
  djQueue?.songs.length >= 1 ? pass(`dj queued ${djQueue.songs.length} songs`) : fail('dj queues songs', 'no queue')
  const djPlaying = player.voices.get(GUILD)?.audioPlayer?.state?.status === 'playing'
  djPlaying ? pass('dj plays the queue') : fail('dj plays the queue', 'not playing')
}
catch (error) {
  fail('dj request', error.message)
}
await cleanup()

console.log('\n=== RESULTS ===')
let failed = 0

for (const [status, name] of results) {
  console.log(`  ${status}  ${name}`)
  if (status === 'FAIL')
    failed++
}

console.log(failed === 0 ? '=== ALL PASS ===' : `=== ${failed} FAILED ===`)
client.destroy()
process.exit(failed === 0 ? 0 : 1)
