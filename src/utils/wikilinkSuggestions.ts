export const MIN_QUERY_LENGTH = 2
export const MAX_RESULTS = 10

export interface WikilinkBaseItem {
  title: string
  aliases: string[]
  group: string
  entryTitle: string
  path: string
}

/**
 * Pre-filter wikilink suggestion candidates using case-insensitive substring
 * matching on title, aliases, and group. This avoids creating expensive
 * onItemClick closures for thousands of entries that won't match anyway.
 *
 * Returns [] when query is shorter than MIN_QUERY_LENGTH.
 */
export function preFilterWikilinks<T extends WikilinkBaseItem>(
  items: T[],
  query: string,
): T[] {
  if (query.length < MIN_QUERY_LENGTH) return []
  const lowerQuery = query.toLowerCase()
  return items.filter(item =>
    item.title.toLowerCase().includes(lowerQuery) ||
    item.aliases.some(a => a.toLowerCase().includes(lowerQuery)) ||
    item.group.toLowerCase().includes(lowerQuery) ||
    item.path.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Map recently-visited paths to their matching items, in visit order.
 * Used to populate the wikilink suggestion menu before the user has typed
 * enough of a query to filter on. Skips `excludePath` (the currently open
 * note) and paths with no matching item (deleted/renamed since last visit).
 */
export function recentWikilinkCandidates<T extends WikilinkBaseItem & { path: string }>(
  items: T[],
  recentPaths: string[],
  excludePath?: string,
  max = MAX_RESULTS,
): T[] {
  const byPath = new Map(items.map(item => [item.path, item]))
  const result: T[] = []
  for (const path of recentPaths) {
    if (result.length >= max) break
    if (path === excludePath) continue
    const item = byPath.get(path)
    if (item) result.push(item)
  }
  return result
}

/** Remove duplicate items by path, keeping the first occurrence. */
export function deduplicateByPath<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })
}

/**
 * When multiple items share the same title, append the parent folder name
 * so the user can distinguish them and BlockNote gets unique React keys.
 */
export function disambiguateTitles<T extends { title: string; path: string }>(
  items: T[],
): T[] {
  const titleCounts = new Map<string, number>()
  for (const item of items) {
    titleCounts.set(item.title, (titleCounts.get(item.title) ?? 0) + 1)
  }
  return items.map(item => {
    if ((titleCounts.get(item.title) ?? 0) <= 1) return item
    const parts = item.path.split('/')
    const folder = parts.length >= 2 ? parts[parts.length - 2] : ''
    return { ...item, title: `${item.title} (${folder})` }
  })
}
