import type { QueueSpec } from './spec.ts'
import { UserError } from '../core/errors.ts'
import { MESSAGES } from '../messages.ts'
import { requireSameVoiceChannel } from './voice.ts'

export const pause: QueueSpec = {
  name: 'pause',
  description: 'Pause the music that is playing. Users say: pausá, pará, pausa, hold on.',
  requiresQueue: true,
  authorize: requireSameVoiceChannel,
  async run(_args, context) {
    if (!context.queue.paused) {
      await context.services.music.pause(context.guildId)
    }

    return { paused: true }
  },
}

export const resume: QueueSpec = {
  name: 'resume',
  description: 'Resume the music that is paused. Users say: seguí, continuá, reanudá, dale, play.',
  requiresQueue: true,
  authorize: requireSameVoiceChannel,
  async run(_args, context) {
    if (context.queue.paused) {
      await context.services.music.resume(context.guildId)
    }

    return { paused: false }
  },
}

export const toggle: QueueSpec = {
  name: 'toggle',
  description: 'Pause or resume whatever is playing.',
  requiresQueue: true,
  modelTool: false,
  fastRoute: false,
  ack: false,
  authorize: requireSameVoiceChannel,
  async run(_args, context) {
    const paused = await context.services.music.toggle(context.guildId)

    return { paused }
  },
}

export const seek: QueueSpec = {
  name: 'seek',
  description: 'Jump to a point of the song that is playing.',
  requiresQueue: true,
  modelTool: false,
  fastRoute: false,
  ack: false,
  authorize: requireSameVoiceChannel,
  async run(args, context) {
    const { songId, seconds } = args

    if (
      typeof songId !== 'string' ||
      typeof seconds !== 'number' ||
      !Number.isInteger(seconds) ||
      seconds < 0
    ) {
      throw new UserError(MESSAGES.seekStale)
    }

    await context.services.music.seek(context.guildId, songId, seconds)

    return { seconds }
  },
}

export const skip: QueueSpec = {
  name: 'skip',
  description:
    'Skip the song that is playing now and play the next one. Users say: saltéala, pasá a la siguiente, poné otra, pasá otra, skipeá, skipeate, skipeá esto, che skipeate esto, skipealo, skipeala, next, skip.',
  requiresQueue: true,
  authorize: requireSameVoiceChannel,
  async run(_args, context) {
    const skipped = context.queue.current?.title ?? null

    await context.services.music.skip(context.guildId, {
      id: context.member.id,
      name: context.member.displayName,
    })

    return { skipped }
  },
}

export const shuffle: QueueSpec = {
  name: 'shuffle',
  description:
    'Shuffle the songs that are waiting in the queue. Users say: mezclá, shuffle, random.',
  requiresQueue: true,
  authorize: requireSameVoiceChannel,
  async run(_args, context) {
    await context.services.music.shuffle(context.guildId)

    return { shuffled: context.queue.size }
  },
}

export const radio: QueueSpec = {
  name: 'radio',
  description:
    'Turn the radio on or off: when it is on, related songs keep playing after the queue runs dry. Users say: prendé la radio, apagá la radio, modo radio.',
  requiresQueue: true,
  authorize: requireSameVoiceChannel,
  confirm: (data) =>
    typeof data.radio === 'boolean'
      ? data.radio
        ? MESSAGES.radioEnabled
        : MESSAGES.radioDisabled
      : null,
  async run(_args, context) {
    const enabled = await context.services.music.radio(context.guildId)

    return { radio: enabled }
  },
}
