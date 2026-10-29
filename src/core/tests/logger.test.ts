import { describe, expect, test } from 'bun:test'
import { logger } from '../logger.ts'

function capture() {
  const lines: string[] = []
  const log = logger({ level: 'debug', sink: line => lines.push(line), now: () => 0 })

  return { log, lines, parsed: () => lines.map(line => JSON.parse(line) as Record<string, unknown>) }
}

describe('logger', () => {
  test('writes one json line per event with the child context', () => {
    const { log, parsed } = capture()
    const child = log.child({ guildId: 'g1' })

    child.info('song.added', { title: 'Tema' })

    expect(parsed()[0]).toMatchObject({
      level: 'info',
      event: 'song.added',
      guildId: 'g1',
      title: 'Tema',
    })
  })

  test('redacts secrets at any depth', () => {
    const { log, parsed } = capture()

    log.info('provider.request', {
      apiKey: 'secret',
      nested: { authorization: 'Bearer secret', model: 'm' },
    })

    expect(parsed()[0]).toMatchObject({
      apiKey: '[redacted]',
      nested: { authorization: '[redacted]', model: 'm' },
    })
  })

  test('drops events below the configured level', () => {
    const lines: string[] = []
    const log = logger({ level: 'warn', sink: line => lines.push(line) })

    log.debug('ignored')
    log.info('ignored')
    log.warn('kept')

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ event: 'kept', level: 'warn' })
  })

  test('serializes errors with their stack', () => {
    const { log, parsed } = capture()

    log.error('provider.failed', new Error('boom'))

    expect(parsed()[0]).toMatchObject({ error: { name: 'Error', message: 'boom' } })
    expect(String((parsed()[0]?.error as Record<string, unknown>).stack)).toContain('boom')
  })
})
