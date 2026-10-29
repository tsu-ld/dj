export interface Clock {
  now: () => number
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

async function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)

      return
    }

    const timer = setTimeout(finish, milliseconds)

    function finish(): void {
      signal?.removeEventListener('abort', abort)
      resolve()
    }

    function abort(): void {
      clearTimeout(timer)
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', abort, { once: true })
  })
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep,
}
