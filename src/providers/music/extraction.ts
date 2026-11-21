import type { Logger } from '../../core/logger.ts'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { parseJson } from '../../core/json.ts'

const METADATA_TIMEOUT_MS = 25_000
const DOWNLOAD_TIMEOUT_MS = 180_000
const STDOUT_LIMIT = 16 * 1024 * 1024
const STDERR_LIMIT = 64 * 1024
const KILL_GRACE_MS = 1_000

// YouTube throttles the default android_vr client's media URLs (403) after a
// burst of requests; the plain android client is unaffected and yields a
// progressive mp4 that ffmpeg can read directly.
const YOUTUBE_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=android']
// YouTube answers 500s on the media URL in bursts
const BASE_ARGS = ['--no-warnings', '--no-progress', '--socket-timeout', '15', '--retries', '10', '--retry-sleep', '2', '--fragment-retries', '5', ...YOUTUBE_CLIENT_ARGS]
const AUDIO_FORMAT = 'ba/ba*'
// ffmpeg is refused YouTube's audio-only urls; ask for the progressive muxed mp4
const MUXED_FORMAT = 'b[acodec!=none][vcodec!=none]'
const DOWNLOAD_ARGS = ['--max-filesize', '200M', '-f', AUDIO_FORMAT]

interface ExtractorOutput {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

interface ExtractorProcess {
  run: (args: readonly string[], timeoutMs: number) => Promise<ExtractorOutput>
  dispose: () => Promise<void>
}

export interface Extractor {
  json: (url: string, extraFlags: readonly string[]) => Promise<unknown>
  streamUrl: (url: string) => Promise<string | null>
  download: (url: string, outputTemplate: string) => Promise<void>
  dispose: () => Promise<void>
}

interface RunningProcess {
  readonly closed: Promise<void>
  readonly stop: (error: Error) => void
}

export function extractorProcess(deps: { command: string, logger: Logger }): ExtractorProcess {
  const running = new Set<RunningProcess>()
  let disposed = false

  async function run(args: readonly string[], timeoutMs: number): Promise<ExtractorOutput> {
    if (disposed)
      throw new Error('The extractor has been disposed.')

    return new Promise((resolve, reject) => {
      // yt-dlp spawns a downloader for merges; killing only the leader leaves it running
      const detached = process.platform !== 'win32'
      const child = spawn(deps.command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], detached })
      const stdout = child.stdout
      const stderr = child.stderr

      let out = ''
      let err = ''
      let failure: Error | null = null
      let settled = false
      let entry: RunningProcess | null = null
      let timer: ReturnType<typeof setTimeout> | undefined
      let hardStop: ReturnType<typeof setTimeout> | undefined

      const finish = (error: Error | null, code: number | null): void => {
        if (settled)
          return

        settled = true
        clearTimeout(timer)
        clearTimeout(hardStop)

        if (entry)
          running.delete(entry)

        if (error !== null)
          reject(error)
        else
          resolve({ code, stdout: out, stderr: err })
      }

      // a killed extractor's grandchild can hold its stdio pipes, so 'close' may never arrive
      const stop = (error: Error): void => {
        if (failure === null)
          failure = error

        try {
          if (detached && child.pid !== undefined)
            process.kill(-child.pid, 'SIGKILL')
          else
            child.kill('SIGKILL')
        }
        catch {
          child.kill('SIGKILL')
        }

        hardStop ??= setTimeout(() => finish(failure, null), KILL_GRACE_MS)
      }

      entry = {
        closed: new Promise<void>((resolveClosed) => {
          child.once('close', () => resolveClosed())
        }),
        stop,
      }
      running.add(entry)

      timer = setTimeout(() => stop(new Error(`The extractor timed out after ${timeoutMs}ms.`)), timeoutMs)

      // multi-byte UTF-8 characters can split across chunk boundaries without an encoding
      stdout.setEncoding('utf8')
      stderr.setEncoding('utf8')

      stdout.on('data', (chunk: string) => {
        if (failure !== null)
          return

        out += chunk

        if (out.length > STDOUT_LIMIT)
          stop(new Error('The extractor produced more output than expected.'))
      })

      stderr.on('data', (chunk: string) => {
        if (err.length >= STDERR_LIMIT)
          return

        err += chunk

        if (err.length > STDERR_LIMIT)
          err = err.slice(0, STDERR_LIMIT)
      })

      child.on('error', error => finish(error, null))
      child.on('close', (code) => {
        // Node emits both error and close on a spawn failure
        finish(failure, code)
      })
    })
  }

  async function dispose(): Promise<void> {
    if (disposed)
      return

    disposed = true

    const active = [...running]

    for (const entry of active)
      entry.stop(new Error('The extractor was disposed while it was running.'))

    deps.logger.debug('music.extractor_disposed', { processes: active.length })

    const closed = Promise.allSettled(active.map(async entry => entry.closed))
    let settle: ReturnType<typeof setTimeout> | undefined

    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        settle = setTimeout(resolve, KILL_GRACE_MS)
      }),
    ])

    if (settle !== undefined)
      clearTimeout(settle)
  }

  return { run, dispose }
}

export function extractor(deps: { command: string, logger: Logger }): Extractor {
  const process = extractorProcess(deps)

  async function json(url: string, extraFlags: readonly string[]): Promise<unknown> {
    const { code, stdout, stderr } = await process.run(
      [...BASE_ARGS, '--dump-single-json', '--skip-download', ...extraFlags, url],
      METADATA_TIMEOUT_MS,
    )

    if (code !== 0)
      throw new Error(stderr.trim() !== '' ? stderr.trim() : `The extractor exited with code ${code}.`)

    const parsed = parseJson(stdout)

    if (parsed === null)
      throw new Error('The extractor returned an invalid JSON payload.')

    return parsed
  }

  async function streamUrl(url: string): Promise<string | null> {
    const { code, stdout } = await process.run([...BASE_ARGS, '-f', MUXED_FORMAT, '-g', url], METADATA_TIMEOUT_MS)
    const line = stdout.split('\n').map(entry => entry.trim()).find(entry => entry.startsWith('https://'))

    if (code !== 0 || line === undefined)
      return null

    return line
  }

  async function download(url: string, outputTemplate: string): Promise<void> {
    const { code, stderr } = await process.run(
      [...BASE_ARGS, ...DOWNLOAD_ARGS, '-o', outputTemplate, url],
      DOWNLOAD_TIMEOUT_MS,
    )

    if (code !== 0)
      throw new Error(`The extractor failed to download ${url}: ${stderr.trim() !== '' ? stderr.trim() : `exit ${code}`}`)
  }

  return { json, streamUrl, download, dispose: process.dispose }
}
