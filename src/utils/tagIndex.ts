import type { VaultEntry } from '../types'

export interface TagCount {
  tag: string
  count: number
}

/** `alphabetical` for stable browsing lists, `frequency` for "most used first" surfaces. */
export type TagCountOrder = 'alphabetical' | 'frequency'

function compareTagCounts(order: TagCountOrder): (a: TagCount, b: TagCount) => number {
  if (order === 'frequency') {
    return (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  }
  return (a, b) => a.tag.localeCompare(b.tag)
}

/** Partially-constructed entries (git placeholders, fixtures) can omit inlineTags. */
export function entryTags(entry: VaultEntry): string[] {
  return entry.inlineTags ?? []
}

/** Count how many entries carry each inline tag. */
export function buildTagCounts(entries: VaultEntry[], order: TagCountOrder = 'alphabetical'): TagCount[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tag of entryTags(entry)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort(compareTagCounts(order))
}
