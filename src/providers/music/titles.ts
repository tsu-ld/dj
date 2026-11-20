const RECENT_TITLES = 30

// A YouTube mix offers what just played under another upload: "The Chain (2004
// Remaster)", "Fleetwood Mac - The Chain - Remastered 2004".
export function titleKeys(title: string): string[] {
  const bare = title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s-\s[^-]*\bremaster(?:ed)?\b[^-]*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dash = bare.indexOf(' - ')
  const name = dash === -1 ? '' : bare.slice(dash + 3).trim()

  return [bare, name].filter(key => key !== '')
}

export function sameSong(title: string, heard: ReadonlySet<string>): boolean {
  return titleKeys(title).some(key => heard.has(key))
}

export function recentTitles(limit = RECENT_TITLES): {
  add: (guildId: string, title: string) => void
  of: (guildId: string) => readonly string[]
} {
  const byGuild = new Map<string, string[]>()

  return {
    add(guildId, title) {
      byGuild.set(guildId, [...byGuild.get(guildId) ?? [], title].slice(-limit))
    },
    of(guildId) {
      return byGuild.get(guildId) ?? []
    },
  }
}
