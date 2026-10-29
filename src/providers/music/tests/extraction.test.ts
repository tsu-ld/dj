import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from 'bun:test'
import { errorMessage } from '../../../core/errors.ts'
import { extractor, extractorProcess } from '../extraction.ts'
import { log, rejection, shellScript, tempDir } from './helpers.ts'

async function readEventually(path: string, timeoutMs = 3_000): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await readFile(path, 'utf8')
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  throw new Error(`The file never appeared: ${path}`)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  }
  catch {
    return false
  }
}

test('the extractor JSON is read from stdout', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'json.sh', `cat <<'JSON'
{"id":"abc123","title":"Tema"}
JSON`)
    const tool = extractor({ command, logger: log })
    const info = await tool.json('https://www.youtube.com/watch?v=abc123')

    expect(info).toEqual({ id: 'abc123', title: 'Tema' })

    await tool.dispose()
  }
  finally {
    await cleanup()
  }
})

test('a failed extractor run reports its stderr', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'fail.sh', 'echo boom >&2\nexit 3')
    const tool = extractor({ command, logger: log })

    expect(await rejection(async () => tool.json('https://www.youtube.com/watch?v=abc123'))).toBe('boom')

    await tool.dispose()
  }
  finally {
    await cleanup()
  }
})

test('an invalid JSON payload is rejected', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'bad.sh', 'echo not-json')
    const tool = extractor({ command, logger: log })

    expect(await rejection(async () => tool.json('https://www.youtube.com/watch?v=abc123'))).toMatch(/invalid JSON/)

    await tool.dispose()
  }
  finally {
    await cleanup()
  }
})

test('a hung extractor process is killed at the timeout', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'hang.sh', 'exec sleep 30')
    const runner = extractorProcess({ command, logger: log })

    expect(await rejection(async () => runner.run([], 50))).toMatch(/timed out/)

    await runner.dispose()
  }
  finally {
    await cleanup()
  }
})

test('dispose kills a running extractor child', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const pidFile = join(dir, 'pid')
    const command = await shellScript(dir, 'child.sh', `echo $$ > '${pidFile}'\nexec sleep 30`)
    const runner = extractorProcess({ command, logger: log })
    const running = runner.run([], 30_000)
    const settled = running.then(() => 'resolved', error => errorMessage(error))
    const pid = Number.parseInt((await readEventually(pidFile)).trim(), 10)

    expect(isAlive(pid)).toBe(true)

    await runner.dispose()

    expect(await settled).toMatch(/disposed/)
    expect(isAlive(pid)).toBe(false)
  }
  finally {
    await cleanup()
  }
})

test('the extractor refuses work after dispose', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'noop.sh', 'exit 0')
    const runner = extractorProcess({ command, logger: log })

    await runner.dispose()

    expect(await rejection(async () => runner.run([], 1_000))).toMatch(/disposed/)
  }
  finally {
    await cleanup()
  }
})

test('a download writes through the extractor output template', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const argsFile = join(dir, 'args.txt')
    const command = await shellScript(dir, 'download.sh', `printf '%s\\n' "$@" > '${argsFile}'
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then out="$2"; shift 2; else shift; fi
done
out=$(printf '%s' "$out" | sed 's/%(ext)s/m4a/')
printf 'audio' > "$out"`)
    const tool = extractor({ command, logger: log })
    const output = join(dir, 'song.%(ext)s')

    await tool.download('https://www.youtube.com/watch?v=abc123', output)

    expect(await readFile(join(dir, 'song.m4a'), 'utf8')).toBe('audio')

    const args = (await readFile(argsFile, 'utf8')).trim().split('\n')
    const maxFileSize = args[args.indexOf('--max-filesize') + 1]
    const client = args[args.indexOf('--extractor-args') + 1]

    expect(maxFileSize).toBe('200M')
    expect(client).toBe('youtube:player_client=android')

    await tool.dispose()
  }
  finally {
    await cleanup()
  }
})

test('a download failure carries the extractor stderr', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const command = await shellScript(dir, 'download-fail.sh', 'echo nope >&2\nexit 9')
    const tool = extractor({ command, logger: log })

    expect(await rejection(async () => tool.download('https://www.youtube.com/watch?v=abc123', join(dir, 'x.%(ext)s')))).toContain('nope')

    await tool.dispose()
  }
  finally {
    await cleanup()
  }
})

test('a spawn failure is reported instead of hanging', async () => {
  const tool = extractor({ command: '/definitely/not/an/extractor', logger: log })

  expect(await rejection(async () => tool.json('https://www.youtube.com/watch?v=abc123'))).not.toBe('')

  await tool.dispose()
})
