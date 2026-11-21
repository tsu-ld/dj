import { spyOn } from 'bun:test'

type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FetchCalls {
  count: () => number
  at: (index: number) => { url: string; init: RequestInit | undefined }
  matching: (path: string) => number
}

const restores: Array<() => void> = []

export function fetchStub(handler: FetchHandler): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(input, init),
    { preconnect: globalThis.fetch.preconnect },
  )
}

export function stubFetch(handler: FetchHandler): FetchCalls {
  const spy = spyOn(globalThis, 'fetch').mockImplementation(fetchStub(handler))

  restores.push(() => spy.mockRestore())

  return {
    count: () => spy.mock.calls.length,
    at(index) {
      const entry = spy.mock.calls[index]

      if (!entry) {
        throw new Error(`No fetch call at index ${index}`)
      }

      return { url: String(entry[0]), init: entry[1] }
    },
    matching: (path) => spy.mock.calls.filter(([input]) => String(input).includes(path)).length,
  }
}

export function restoreFetch(): void {
  while (restores.length > 0) {
    restores.pop()?.()
  }
}

export function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
