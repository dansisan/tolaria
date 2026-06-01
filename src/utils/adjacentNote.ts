import type { VaultEntry } from '../types'

/**
 * After a note is removed from the visible list, pick which note should become
 * active. Prefers the next note below the removed one so deletes walk down the
 * list; falls back to the note above when the removed note was last. The
 * `excluded` set lets bulk deletes skip notes that are also being removed.
 * Returns null when no surviving neighbor exists.
 */
export function resolveAdjacentNote(
  entries: VaultEntry[],
  removedPath: string,
  excluded?: ReadonlySet<string>,
): VaultEntry | null {
  const removedIndex = entries.findIndex((entry) => entry.path === removedPath)
  if (removedIndex === -1) return null

  const survives = (entry: VaultEntry) =>
    entry.path !== removedPath && !excluded?.has(entry.path)

  for (let i = removedIndex + 1; i < entries.length; i++) {
    if (survives(entries[i])) return entries[i]
  }
  for (let i = removedIndex - 1; i >= 0; i--) {
    if (survives(entries[i])) return entries[i]
  }
  return null
}
