import type { CommandSpec } from './spec.ts'
import { EMPTY_PARAMETERS } from './parameters.ts'

export const pause: CommandSpec = {
  name: 'pause',
  description: 'Pause the music that is playing. Users say: pausá, pará, pausa, hold on.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    if (!context.queue?.paused)
      await context.services.music.pause(context.guildId)

    return { paused: true }
  },
}

export const resume: CommandSpec = {
  name: 'resume',
  description: 'Resume the music that is paused. Users say: seguí, continuá, reanudá, dale, play.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    if (context.queue?.paused)
      await context.services.music.resume(context.guildId)

    return { paused: false }
  },
}

// Button-only: a blind toggle is fine for the now-playing row, but the model
// must name the outcome.
export const toggle: CommandSpec = {
  name: 'toggle',
  description: 'Pause or resume whatever is playing.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  modelTool: false,
  fastRoute: false,
  ack: false,
  async run(_args, context) {
    const paused = await context.services.music.toggle(context.guildId)

    return { paused }
  },
}

export const skip: CommandSpec = {
  name: 'skip',
  description: 'Skip the song that is playing now and play the next one. Users say: saltéala, pasá a la siguiente, poné otra, pasá otra, skipeá, skipeate, skipeá esto, che skipeate esto, skipealo, skipeala, next, skip.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    const skipped = context.queue?.current?.title ?? null

    await context.services.music.skip(context.guildId)

    return { skipped }
  },
}

export const shuffle: CommandSpec = {
  name: 'shuffle',
  description: 'Shuffle the songs that are waiting in the queue. Users say: mezclá, shuffle, random.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    await context.services.music.shuffle(context.guildId)

    return { shuffled: context.queue?.size ?? 0 }
  },
}

export const radio: CommandSpec = {
  name: 'radio',
  description: 'Turn the radio on or off: when it is on, related songs keep playing after the queue runs dry. Users say: prendé la radio, apagá la radio, modo radio.',
  parameters: EMPTY_PARAMETERS,
  requiresQueue: true,
  async run(_args, context) {
    const enabled = await context.services.music.radio(context.guildId)

    return { radio: enabled }
  },
}
