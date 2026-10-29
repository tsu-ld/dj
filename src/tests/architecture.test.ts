import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { expect, test } from 'bun:test'

const ROOT = resolve(import.meta.dirname, '../..')
const SRC = join(ROOT, 'src')
const MAX_SOURCE_LINES = 300

function sourceFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'tests')
        continue

      files.push(...sourceFiles(path))
    }
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path)
    }
  }

  return files
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')

  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map(match => match[1])
    .filter((specifier): specifier is string => specifier !== undefined)
    .filter(specifier => specifier.startsWith('.'))
    .map(specifier => resolve(dirname(file), specifier))
}

function areaOf(file: string): string {
  if (file === join(SRC, 'app.ts') || file === join(SRC, 'index.ts'))
    return 'app'

  const parts = relative(SRC, file).split(sep)

  return parts.length === 1 ? 'root' : parts[0] ?? 'root'
}

const files = sourceFiles(SRC)
const imports = new Map(files.map(file => [file, importsOf(file)]))

// Every relative import must resolve. A path that exists only in a branch is a
// crash waiting for that branch.
test('every relative import points at a real file', () => {
  const missing = [...imports].flatMap(([file, targets]) =>
    targets
      .filter(target => !existsSync(target))
      .map(target => `${relative(SRC, file)} -> ${relative(SRC, target)}`),
  )

  expect(missing).toEqual([])
})

test('the source graph is acyclic', () => {
  const state = new Map<string, 'visiting' | 'done'>()
  const cycles: string[] = []

  function visit(file: string, stack: string[]): void {
    if (state.get(file) === 'done')
      return

    if (state.get(file) === 'visiting') {
      cycles.push([...stack, file].map(path => relative(SRC, path)).join(' -> '))

      return
    }

    state.set(file, 'visiting')

    for (const target of imports.get(file) ?? []) {
      if (files.includes(target))
        visit(target, [...stack, file])
    }

    state.set(file, 'done')
  }

  for (const file of files)
    visit(file, [])

  expect(cycles).toEqual([])
})

const FORBIDDEN: Record<string, readonly string[]> = {
  'providers': ['commands', 'discord', 'dj', 'on-air', 'app'],
  'dj': ['providers', 'discord', 'on-air', 'app'],
  'on-air': ['providers', 'discord', 'commands', 'app'],
  'commands': ['providers', 'discord', 'dj', 'on-air', 'app'],
  'discord': ['providers', 'dj', 'on-air', 'app'],
  'ports': ['providers', 'discord', 'dj', 'on-air', 'commands', 'app'],
  'core': ['providers', 'discord', 'dj', 'on-air', 'commands', 'root', 'app'],
}

test('no area imports a layer above it', () => {
  const violations: string[] = []

  for (const [file, targets] of imports) {
    const from = areaOf(file)
    const forbidden = FORBIDDEN[from]

    if (!forbidden)
      continue

    for (const target of targets) {
      if (!existsSync(target))
        continue

      const to = areaOf(target)

      if (forbidden.includes(to))
        violations.push(`${relative(SRC, file)} (${from}) -> ${relative(SRC, target)} (${to})`)
    }
  }

  expect(violations).toEqual([])
})

// The provider folder is the only place a technology may be named. Keeping the
// check on paths means a folder cannot quietly become the architecture.
test('a provider technology name never leaks into a path', () => {
  const names = ['distube', 'yt-dlp', 'ytdlp', 'elevenlabs', 'openai', 'jev', 'systemone']
  const leaked = files
    .map(file => relative(SRC, file).toLowerCase())
    .filter(path => names.some(name => path.includes(name)))

  expect(leaked).toEqual([])
})

test('only the configuration module reads the environment', () => {
  const readers = files
    .filter(file => readFileSync(file, 'utf8').includes('process.env'))
    .map(file => relative(SRC, file))

  expect(readers).toEqual(['config.ts'])
})

test('no source file outgrows a single concern', () => {
  const large = files
    .map(file => ({ file: relative(SRC, file), lines: readFileSync(file, 'utf8').split('\n').length }))
    .filter(({ lines }) => lines > MAX_SOURCE_LINES)

  expect(large).toEqual([])
})

test('production code logs through the logger, never console', () => {
  const consoles = files
    .filter(file => /\bconsole\.(?:log|info|warn|error|debug)\b/.test(readFileSync(file, 'utf8')))
    .map(file => relative(SRC, file))

  expect(consoles).toEqual([])
})
