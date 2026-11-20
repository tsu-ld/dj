import { spyOn } from 'bun:test'

export type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface FetchCalls {
  count: () => number
  at: (index: number) => { url: string, init: RequestInit | undefined }
  matching: (path: string) => number
}

const restores: (() => void)[] = []

// Bun's fetch carries a static helper, so the stub has to carry it too.
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

      if (!entry)
        throw new Error(`No fetch call at index ${index}`)

      return { url: String(entry[0]), init: entry[1] }
    },
    matching: path => spy.mock.calls.filter(([input]) => String(input).includes(path)).length,
  }
}

// Call from afterEach so the next test meets the real fetch.
export function restoreFetch(): void {
  while (restores.length > 0)
    restores.pop()?.()
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
