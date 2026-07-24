import type { VaultEntry } from '../types'

export function sortFavorites(entries: VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => entry.favorite && !entry.archived)
    .sort((a, b) => (a.favoriteIndex ?? Infinity) - (b.favoriteIndex ?? Infinity))
}
