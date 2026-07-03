import type { VaultEntry } from '../types'

/**
 * Beyond this many changed paths a full vault reload is cheaper and safer than
 * issuing one reload_vault_entry round-trip per file.
 */
export const WATCHER_PARTIAL_REFRESH_MAX_PATHS = 25

export type WatcherRefreshOutcome = 'handled' | 'full-reload-required'

export interface WatcherPartialRefreshDeps {
  /** Current in-memory entry for a path, or undefined when unknown. */
  findEntry: (path: string) => VaultEntry | undefined
  /** Re-parses a single note from disk (reload_vault_entry). Throws when unreadable. */
  reloadEntry: (path: string) => Promise<VaultEntry>
  updateEntry: (path: string, entry: VaultEntry) => void
  reloadViews: () => Promise<unknown> | unknown
  refreshGitModifiedFiles: () => Promise<unknown> | unknown
  isActiveTabPath: (path: string) => boolean
  hasUnsavedChanges: (path: string) => boolean
  /** True while focus is inside the editor surface — never yank the note mid-typing. */
  isEditorFocused: () => boolean
  replaceActiveTab: (entry: VaultEntry) => Promise<void>
}

function isViewDefinitionPath(path: string): boolean {
  return path.endsWith('.yml') || path.endsWith('.yaml')
}

function canRefreshInPlace(paths: string[], deps: WatcherPartialRefreshDeps): boolean {
  if (paths.length === 0 || paths.length > WATCHER_PARTIAL_REFRESH_MAX_PATHS) return false
  return paths.every((path) => deps.findEntry(path) !== undefined)
}

function shouldReplaceActiveTab(path: string, deps: WatcherPartialRefreshDeps): boolean {
  return deps.isActiveTabPath(path)
    && !deps.hasUnsavedChanges(path)
    && !deps.isEditorFocused()
}

/**
 * Applies a watcher change notification by re-parsing only the named files,
 * instead of rescanning the entire vault. External events name specific paths
 * almost always (a synced note, another app touching one file); reloading
 * thousands of entries for that froze typing for seconds on large vaults.
 *
 * Anything structural — unknown/new paths, deletions (reload fails), or bulk
 * changes — reports `full-reload-required` so the caller can run the existing
 * full reload, which reconciles every case.
 */
export async function applyWatcherPartialRefresh(
  paths: string[],
  deps: WatcherPartialRefreshDeps,
): Promise<WatcherRefreshOutcome> {
  if (!canRefreshInPlace(paths, deps)) return 'full-reload-required'

  let refreshedActiveEntry: VaultEntry | null = null
  try {
    for (const path of paths) {
      const entry = await deps.reloadEntry(path)
      deps.updateEntry(path, entry)
      if (shouldReplaceActiveTab(path, deps)) refreshedActiveEntry = entry
    }
  } catch {
    return 'full-reload-required'
  }

  if (paths.some(isViewDefinitionPath)) await deps.reloadViews()
  if (refreshedActiveEntry) await deps.replaceActiveTab(refreshedActiveEntry)
  await deps.refreshGitModifiedFiles()
  return 'handled'
}
