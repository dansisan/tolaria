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
  /**
   * Parses a path the entry list doesn't know yet (scan_vault_entry), or resolves
   * to null when a full vault scan would not list it — a directory, a hidden
   * file, or a gitignored path while those are hidden.
   */
  scanEntry: (path: string) => Promise<VaultEntry | null>
  addEntry: (entry: VaultEntry) => void
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

function canRefreshInPlace(paths: string[]): boolean {
  return paths.length > 0 && paths.length <= WATCHER_PARTIAL_REFRESH_MAX_PATHS
}

/**
 * Re-parses one changed path and folds it into the entry list: known paths are
 * updated in place, new ones are appended the same way an in-app note create
 * does. Resolves to null when the path is not something the vault list holds,
 * so the caller can fall back to a full reload.
 */
async function applyChangedPath(
  path: string,
  deps: WatcherPartialRefreshDeps,
): Promise<VaultEntry | null> {
  if (deps.findEntry(path) === undefined) {
    const addedEntry = await deps.scanEntry(path)
    if (addedEntry) deps.addEntry(addedEntry)
    return addedEntry
  }
  const entry = await deps.reloadEntry(path)
  deps.updateEntry(path, entry)
  return entry
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
 * A file created outside the app is folded in with the same single-entry insert
 * an in-app create uses — there is no reason for the two to cost differently.
 *
 * What still reports `full-reload-required` is what a single-entry insert cannot
 * reconcile: bulk changes, deletions (reload fails), and paths the vault list
 * would never hold, such as a new directory.
 */
export async function applyWatcherPartialRefresh(
  paths: string[],
  deps: WatcherPartialRefreshDeps,
): Promise<WatcherRefreshOutcome> {
  if (!canRefreshInPlace(paths)) return 'full-reload-required'

  let refreshedActiveEntry: VaultEntry | null = null
  try {
    for (const path of paths) {
      const entry = await applyChangedPath(path, deps)
      if (!entry) return 'full-reload-required'
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
