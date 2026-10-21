import type { VaultEntry } from '../types'

export const DEFAULT_RECENT_NOTES_COUNT = 5
export const MAX_RECENT_NOTES_COUNT = 20
/** 0 hides the sidebar Recent section. */
export const RECENT_NOTES_COUNT_OPTIONS = [0, 3, 5, 10, 15, MAX_RECENT_NOTES_COUNT] as const

export function normalizeRecentNotesCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_RECENT_NOTES_COUNT
  if (value < 0 || value > MAX_RECENT_NOTES_COUNT) return DEFAULT_RECENT_NOTES_COUNT
  return value
}

/** Resolve visited paths to live entries, newest first, skipping deleted/archived notes. */
export function resolveRecentEntries(
  entries: VaultEntry[],
  recentPaths: readonly string[],
  count: number,
): VaultEntry[] {
  if (count <= 0) return []
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const resolved: VaultEntry[] = []
  for (const path of recentPaths) {
    const entry = byPath.get(path)
    if (entry && !entry.archived) resolved.push(entry)
    if (resolved.length >= count) break
  }
  return resolved
}
