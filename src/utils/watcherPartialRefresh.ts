import type { VaultEntry } from '../types'

/**
 * Beyond this many changed paths a full vault reload is cheaper and safer than
 * issuing one reload_vault_entry round-trip per file.
 */
export const WATCHER_PARTIAL_REFRESH_MAX_PATHS = 25

export type WatcherRefreshOutcome = 'handled' | 'full-reload-required'

/**
 * What `scan_vault_entry` found. `missing` and `unlisted` both mean the entry
 * list should hold nothing at that path, but they are not interchangeable: a
 * vanished file leaves the list already correct, while an unlisted one — a new
 * directory, a hidden or gitignored file — can be a structural change the
 * folder tree and saved views still need to see.
 */
export type ScannedVaultPath =
  | { status: 'entry'; entry: VaultEntry }
  | { status: 'missing' }
  | { status: 'unlisted' }

export interface WatcherPartialRefreshDeps {
  /** Current in-memory entry for a path, or undefined when unknown. */
  findEntry: (path: string) => VaultEntry | undefined
  /** Re-parses a single note from disk (reload_vault_entry). Throws when unreadable. */
  reloadEntry: (path: string) => Promise<VaultEntry>
  /** What the vault holds at a path right now (scan_vault_entry). */
  scanEntry: (path: string) => Promise<ScannedVaultPath>
  addEntry: (entry: VaultEntry) => void
  removeEntry: (path: string) => void
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

type ChangedPathOutcome =
  | { kind: 'entry'; entry: VaultEntry }
  | { kind: 'settled' }
  | { kind: 'full-reload' }

const SETTLED: ChangedPathOutcome = { kind: 'settled' }

/**
 * A known note whose re-parse failed either vanished or was briefly unreadable.
 * Only the vault can tell those apart, and a path it no longer lists — deleted,
 * or newly gitignored — drops out of the entry list either way. The open note is
 * the exception: closing its tab and tearing down the editor is the full
 * reload's job, so leave that case to it.
 */
async function applyMissingKnownPath(
  path: string,
  deps: WatcherPartialRefreshDeps,
): Promise<ChangedPathOutcome> {
  const scanned = await deps.scanEntry(path)
  if (scanned.status === 'entry') {
    deps.updateEntry(path, scanned.entry)
    return { kind: 'entry', entry: scanned.entry }
  }
  if (deps.isActiveTabPath(path)) return { kind: 'full-reload' }
  deps.removeEntry(path)
  return SETTLED
}

/**
 * A path the entry list doesn't hold. A file there is inserted; a vanished one
 * needs nothing, which is the common case — the app's own delete drops the
 * entry before its filesystem event arrives, so the event describes work
 * already done. Anything else present but unlisted can be structural (a new
 * directory), which only the full reload reconciles.
 */
async function applyUnknownPath(
  path: string,
  deps: WatcherPartialRefreshDeps,
): Promise<ChangedPathOutcome> {
  const scanned = await deps.scanEntry(path)
  if (scanned.status === 'entry') {
    deps.addEntry(scanned.entry)
    return { kind: 'entry', entry: scanned.entry }
  }
  return scanned.status === 'missing' ? SETTLED : { kind: 'full-reload' }
}

/**
 * Folds one changed path into the entry list: a known note is re-parsed in
 * place or dropped once it is gone, and a path the list doesn't hold yet is
 * appended the same way an in-app note create appends it.
 */
async function applyChangedPath(
  path: string,
  deps: WatcherPartialRefreshDeps,
): Promise<ChangedPathOutcome> {
  if (deps.findEntry(path) === undefined) return applyUnknownPath(path, deps)

  const entry = await deps.reloadEntry(path).catch(() => null)
  if (!entry) return applyMissingKnownPath(path, deps)
  deps.updateEntry(path, entry)
  return { kind: 'entry', entry }
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
 * A file created or deleted outside the app is folded in with the same
 * single-entry insert and removal the in-app create and delete use — there is
 * no reason for the two to cost differently.
 *
 * The app's own writes are normally suppressed before they reach here, but that
 * window can lapse when the main thread is busy, so an echo of work the app
 * already applied must cost nothing rather than fall through to a reload.
 *
 * What still reports `full-reload-required` is what a single-entry edit cannot
 * reconcile: bulk changes, a deletion of the note currently open, and paths
 * that hold something the vault list would never show, such as a new directory.
 */
export async function applyWatcherPartialRefresh(
  paths: string[],
  deps: WatcherPartialRefreshDeps,
): Promise<WatcherRefreshOutcome> {
  if (!canRefreshInPlace(paths)) return 'full-reload-required'

  let refreshedActiveEntry: VaultEntry | null = null
  try {
    for (const path of paths) {
      const outcome = await applyChangedPath(path, deps)
      if (outcome.kind === 'full-reload') return 'full-reload-required'
      if (outcome.kind === 'entry' && shouldReplaceActiveTab(path, deps)) {
        refreshedActiveEntry = outcome.entry
      }
    }
  } catch {
    return 'full-reload-required'
  }

  if (paths.some(isViewDefinitionPath)) await deps.reloadViews()
  if (refreshedActiveEntry) await deps.replaceActiveTab(refreshedActiveEntry)
  await deps.refreshGitModifiedFiles()
  return 'handled'
}
