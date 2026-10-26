import { spawn } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtractorPlugin, Playlist, Song } from 'distube'
import { assertYtDlpUrl, liveError } from './yt-dlp-policy.js'

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
const BASE_ARGS = ['--no-warnings', '--no-progress', '--socket-timeout', '15', '--retries', '2', '--fragment-retries', '2', ...YT_CLIENT_ARGS]
const DOWNLOAD_ARGS = ['--max-filesize', '200M', '-f', 'ba/ba*']

const downloadsInFlight = new Map()

// yt-dlp resolves YouTube metadata and streams far more reliably than ytdl-core
// (which fails to decipher current YouTube player JS). YouTube's googlevideo
// audio URLs only answer closed-range requests, which ffmpeg cannot stream, so
// the audio is downloaded to a local file and played from there. yt-dlp's own
// wrapper merges stderr into its JSON parse, so spawn it directly, reading
// stdout only and suppressing warnings.
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

      return entries.map(entry => this.buildSong(entry, {}))
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

    const file = await downloadAudio(song.url, song.id)

    return `file://${join(AUDIO_DIR, file)}`
  }

  buildSong(info, options) {
    const live = isLiveInfo(info)

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
