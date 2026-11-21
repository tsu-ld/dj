type PresentFields<T> = { [K in keyof T]?: NonNullable<T[K]> }

export function presentFields<T extends object>(fields: T): PresentFields<T> {
  const present: PresentFields<T> = {}

  for (const key in fields) {
    const value = fields[key]

    if (value !== undefined && value !== null) {
      present[key] = value
    }
  }

  return present
}
