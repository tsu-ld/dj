import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtractorPlugin, Playlist, Song } from 'distube'
import { assertYtDlpUrl, isYtDlpUrl, liveError } from './yt-dlp-policy.js'

const AUDIO_DIR = join(tmpdir(), 'dj-audio')
const FILE_MAX_AGE_MS = 86_400_000
const MAX_CACHE_BYTES = 512 * 1024 * 1024
const MAX_PLAYLIST_SONGS = 50
const RELATED_SONGS_LIMIT = 10
const METADATA_TIMEOUT_MS = 25_000
const DOWNLOAD_TIMEOUT_MS = 180_000
const STDOUT_LIMIT = 16 * 1024 * 1024
const STDERR_LIMIT = 64 * 1024

// YouTube throttles the default android_vr client's media URLs (403) after a
// burst of requests; the plain android client is unaffected and yields a
// progressive mp4 that ffmpeg can read directly.
const YT_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=android']
// YouTube answers 500s on the media URL in bursts; two retries were not enough
// and the song died after the DJ had already announced it.
const BASE_ARGS = ['--no-warnings', '--no-progress', '--socket-timeout', '15', '--retries', '10', '--retry-sleep', '2', '--fragment-retries', '5', ...YT_CLIENT_ARGS]
const AUDIO_FORMAT = 'ba/ba*'
// ffmpeg only gets through the progressive mp4; ask for a muxed format by name.
const MUXED_FORMAT = 'b[acodec!=none][vcodec!=none]'
const DOWNLOAD_ARGS = ['--max-filesize', '200M', '-f', AUDIO_FORMAT]
// A googlevideo url dies after a few hours; re-resolve well before it does.
const STREAM_URL_MARGIN_MS = 5 * 60_000

const downloadsInFlight = new Map()
const streamUrls = new Map()
const prefetchInFlight = new Set()
let beforeStream = null

// The gap before a song belongs to the dj: it registers the work that has to
// finish before the stream starts, so a spoken line never plays over the music.
export function setBeforeStream(hook) {
  beforeStream = hook
}

// yt-dlp resolves YouTube metadata and streams far more reliably than ytdl-core
// (which fails to decipher current YouTube player JS). Audio-only urls answer 403
// to ffmpeg, but the android client's progressive mp4 streams directly, so a song
// starts playing while the next one downloads: the file keeps the queue resilient
// and repeats instant, the direct url is only the shortcut for the first track.
// yt-dlp's own wrapper merges stderr into its JSON parse, so spawn it directly,
// reading stdout only and suppressing warnings.
// spawn has no timeout option: a timer SIGKILLs a hung yt-dlp. Output is capped
// so a live stream or a chatty process cannot grow the bot's memory.
export async function runYtDlp(args, { timeoutMs, command = 'yt-dlp' } = {}) {
  const proc = spawn(command, args)
  let stdout = ''
  let stderr = ''
  let failure = null

  const stop = (error) => {
    if (failure)
      return

    failure = error
    proc.kill('SIGKILL')
  }

  const timer = setTimeout(() => stop(new Error(`yt-dlp timed out after ${timeoutMs}ms`)), timeoutMs)

  // multi-byte UTF-8 characters can split across chunk boundaries without an encoding
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    if (failure)
      return

    stdout += chunk

    if (stdout.length > STDOUT_LIMIT)
      stop(new Error('yt-dlp produced more output than expected'))
  })
  proc.stderr.on('data', (chunk) => {
    if (stderr.length >= STDERR_LIMIT)
      return

    stderr += chunk

    if (stderr.length > STDERR_LIMIT)
      stderr = stderr.slice(0, STDERR_LIMIT)
  })

  let code

  try {
    code = await new Promise((resolve, reject) => {
      proc.on('error', reject)
      proc.on('close', resolve)
    })
  }
  finally {
    clearTimeout(timer)
  }

  if (failure)
    throw failure

  return { code, stdout, stderr }
}

async function ytDlpJson(url, extraFlags = []) {
  const { code, stdout, stderr } = await runYtDlp([...BASE_ARGS, '--dump-single-json', '--skip-download', ...extraFlags, url], { timeoutMs: METADATA_TIMEOUT_MS })

  if (code !== 0)
    throw new Error(stderr.trim() || `yt-dlp exited with code ${code}`)

  return JSON.parse(stdout)
}

function isLiveInfo(info) {
  return Boolean(info.is_live) || info.live_status === 'is_live' || info.live_status === 'is_upcoming'
}

// yt-dlp leaves <id>.<ext>.part (and legacy .ytdl) files behind mid-download; only a finished file may be played
export function finishedAudioFile(files, id) {
  return files.find(file => file.startsWith(`${id}.`) && !file.endsWith('.part') && !file.endsWith('.ytdl'))
}

export function safeFileId(id) {
  return String(id ?? '').replace(/[^\w-]/g, '_')
}

// ffmpeg can only stream YouTube's progressive mp4: the audio-only urls answer
// 403, and a download handles those (yt-dlp sends what ffmpeg does not).
export function directStreamUrl(formats = []) {
  const playable = formats.filter(format => format?.url && format.protocol === 'https' && format.acodec !== 'none' && format.vcodec !== 'none')

  return playable[0]?.url
}

export function isUrlFresh(entry, now = Date.now()) {
  return Boolean(entry?.url) && entry.expiresAt - now > STREAM_URL_MARGIN_MS
}

// googlevideo carries the expiry in seconds; the margin above works in ms.
export function urlExpiresAt(url) {
  const expire = Number(new URL(url).searchParams.get('expire'))

  return Number.isFinite(expire) && expire > 0 ? expire * 1000 : Number.POSITIVE_INFINITY
}

function rememberStreamUrl(id, url) {
  if (!id || !url)
    return

  for (const [key, entry] of streamUrls) {
    if (!isUrlFresh(entry))
      streamUrls.delete(key)
  }

  streamUrls.set(id, { url, expiresAt: urlExpiresAt(url) })
}

async function directUrlFor(song) {
  const remembered = streamUrls.get(song.id)

  if (isUrlFresh(remembered))
    return remembered.url

  streamUrls.delete(song.id)

  const { code, stdout } = await runYtDlp([...BASE_ARGS, '-f', MUXED_FORMAT, '-g', song.url], { timeoutMs: METADATA_TIMEOUT_MS })
  const url = stdout.split('\n').map(line => line.trim()).find(line => line.startsWith('https://'))

  if (code !== 0 || !url)
    return null

  rememberStreamUrl(song.id, url)

  return url
}

async function playableUrl(song) {
  const file = finishedAudioFile(await readdir(AUDIO_DIR).catch(() => []), safeFileId(song.id))

  if (file)
    return `file://${join(AUDIO_DIR, file)}`

  const url = await directUrlFor(song).catch((error) => {
    console.error('[Music] Could not resolve a stream url, downloading instead:', error)

    return null
  })

  if (url)
    return url

  return `file://${join(AUDIO_DIR, await downloadAudio(song.url, song.id))}`
}

async function waitForTheDj(song) {
  if (!beforeStream)
    return

  try {
    await beforeStream(song)
  }
  catch (error) {
    console.error('[Music] The dj line failed before the stream:', error)
  }
}

// The line and the fetch run together, so the line covers the wait. The music
// still starts only after the line ends, and a song that fails to resolve lets
// the line finish before the next song takes the connection.
export async function streamWithDjLine(song, { fetchUrl = playableUrl, line = waitForTheDj } = {}) {
  const speech = line(song)

  try {
    const url = await fetchUrl(song)

    await speech

    return url
  }
  catch (error) {
    await speech

    throw error
  }
}

// The next track downloads while the current one plays, so from the second song
// on the queue reads from disk: instant start, and the network only matters for
// the first track. Spotify songs resolve to YouTube later, so they are skipped.
export function prefetchAudio(song, guildId, download = downloadAudio) {
  if (!song?.url || song.isLive || !isYtDlpUrl(song.url) || prefetchInFlight.has(guildId))
    return

  prefetchInFlight.add(guildId)

  download(song.url, song.id)
    .catch(error => console.error('[Music] Could not prefetch the next song:', error))
    .finally(() => prefetchInFlight.delete(guildId))
}

async function downloadAudio(url, id) {
  const fileId = safeFileId(id)
  const pending = downloadsInFlight.get(fileId)

  if (pending)
    return pending

  const download = downloadAudioFile(url, fileId).finally(() => downloadsInFlight.delete(fileId))
  downloadsInFlight.set(fileId, download)

  return download
}

async function downloadAudioFile(url, id) {
  await mkdir(AUDIO_DIR, { recursive: true })
  await cleanOldFiles()

  const existing = finishedAudioFile(await readdir(AUDIO_DIR), id)

  if (existing)
    return existing

  const { code, stderr } = await runYtDlp([...BASE_ARGS, ...DOWNLOAD_ARGS, '-o', join(AUDIO_DIR, `${id}.%(ext)s`), url], { timeoutMs: DOWNLOAD_TIMEOUT_MS })

  if (code !== 0)
    throw new Error(`yt-dlp failed to download ${url}: ${stderr.trim() || `exit ${code}`}`)

  const file = finishedAudioFile(await readdir(AUDIO_DIR), id)

  if (!file)
    throw new Error('yt-dlp downloaded audio but no file was found')

  return file
}

async function cleanOldFiles() {
  const now = Date.now()
  const files = []
  let removedBytes = 0

  for (const file of await readdir(AUDIO_DIR)) {
    const path = join(AUDIO_DIR, file)
    const info = await stat(path).catch(() => null)

    if (!info?.isFile())
      continue

    if (now - info.mtimeMs > FILE_MAX_AGE_MS) {
      await rm(path, { force: true })
      removedBytes += info.size
      continue
    }

    // Partial downloads belong to a process that may still be writing them.
    if (!file.endsWith('.part') && !file.endsWith('.ytdl'))
      files.push({ path, size: info.size, mtimeMs: info.mtimeMs })
  }

  let totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (totalBytes <= MAX_CACHE_BYTES)
      break

    await rm(file.path, { force: true })
    totalBytes -= file.size
    removedBytes += file.size
  }

  if (removedBytes > 0)
    console.info(`[Music] Removed ${removedBytes} bytes of cached audio`)
}

export class YtDlpPlugin extends ExtractorPlugin {
  // validate() stays permissive on purpose: distube only follows a redirect with
  // a HEAD request when no plugin validates the URL, so the allowlist is enforced
  // in resolve() and by assertSupportedMusicUrl() before player.play().
  validate() {
    return true
  }

  async getRelatedSongs(song) {
    if (!song.id)
      return []

    try {
      // RD<id> is YouTube's mix (radio) playlist for that video.
      const info = await ytDlpJson(
        `https://www.youtube.com/watch?v=${song.id}&list=RD${song.id}`,
        ['--flat-playlist', '--playlist-end', String(RELATED_SONGS_LIMIT)],
      )
      const entries = (info.entries ?? [])
        .filter(entry => entry?.id && entry.id !== song.id && !isLiveInfo(entry))
        .slice(0, RELATED_SONGS_LIMIT)

      // Autoplay adds these behind the user's back: the dj talks less over them.
      return entries.map((entry) => {
        const related = this.buildSong(entry, {})

        related.fromRadio = true

        return related
      })
    }
    catch (error) {
      console.error('[Music] Could not fetch related songs:', error)

      return []
    }
  }

  async searchSong(query, options) {
    const info = await ytDlpJson(`ytsearch1:${query}`, ['--no-playlist'])
    const first = info.entries?.[0]

    return first ? this.buildSong(first, options) : null
  }

  async resolve(url, options) {
    assertYtDlpUrl(url)

    const info = await ytDlpJson(url, ['--flat-playlist', '--playlist-end', String(MAX_PLAYLIST_SONGS)])

    if (info._type === 'playlist') {
      const entries = (info.entries ?? []).filter(entry => entry?.id)

      if (entries.length === 0)
        throw new Error('The playlist is empty')

      const playable = entries.filter(entry => !isLiveInfo(entry))

      if (playable.length === 0)
        throw liveError()

      if (playable.length < entries.length)
        console.info(`[Music] Skipped ${entries.length - playable.length} live or upcoming songs`)

      const playlistSize = info.playlist_count ?? entries.length

      if (playlistSize > MAX_PLAYLIST_SONGS)
        console.info(`[Music] Playlist capped at ${MAX_PLAYLIST_SONGS} songs (${playlistSize} entries)`)

      return new Playlist(
        {
          source: info.extractor ?? 'youtube',
          songs: playable.slice(0, MAX_PLAYLIST_SONGS).map(entry => this.buildSong(entry, options)),
          id: info.id.toString(),
          name: info.title,
          url: info.webpage_url,
          thumbnail: info.thumbnail ?? info.thumbnails?.[0]?.url,
        },
        options,
      )
    }

    if (isLiveInfo(info))
      throw liveError()

    return this.buildSong(info, options)
  }

  async getStreamURL(song) {
    if (song.isLive)
      throw liveError()

    return streamWithDjLine(song)
  }

  buildSong(info, options) {
    const live = isLiveInfo(info)

    rememberStreamUrl(info.id, directStreamUrl(info.formats))

    return new Song(
      {
        plugin: this,
        source: info.extractor ?? 'youtube',
        playFromSource: true,
        id: info.id,
        name: info.title || info.fulltitle,
        // flat playlist entries carry their watch URL as url, not webpage_url
        url: info.webpage_url || info.original_url || (info._type === 'url' ? info.url : undefined),
        isLive: live,
        thumbnail: info.thumbnail ?? info.thumbnails?.[0]?.url,
        duration: live ? 0 : info.duration,
        uploader: {
          name: info.uploader,
          url: info.uploader_url,
        },
        views: info.view_count,
        likes: info.like_count,
        ageRestricted: info.age_limit >= 18,
      },
      options,
    )
  }
}
