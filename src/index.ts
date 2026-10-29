import process from 'node:process'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { ConfigError } from './core/errors.ts'

async function main(): Promise<void> {
  const config = loadConfig()
  const app = await createApp(config)
  let stopping = false

  async function stop(reason: string, exitCode = 0): Promise<void> {
    if (stopping)
      return

    stopping = true
    app.logger.info('process.stopping', { reason })

    try {
      await app.stop()
    }
    finally {
      process.exit(exitCode)
    }
  }

  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('unhandledRejection', (error) => {
    app.logger.error('process.unhandled_rejection', error)
    void stop('unhandledRejection', 1)
  })
  process.on('uncaughtException', (error) => {
    app.logger.error('process.uncaught_exception', error)
    void stop('uncaughtException', 1)
  })

  try {
    await app.start()
  }
  catch (error) {
    app.logger.error('app.start_failed', error)
    await stop('startup', 1)
  }
}

main().catch((error) => {
  const detail = error instanceof ConfigError ? error.message : error instanceof Error ? error.stack ?? error.message : String(error)

  process.stderr.write(`${detail}\n`)
  process.exitCode = 1
})
