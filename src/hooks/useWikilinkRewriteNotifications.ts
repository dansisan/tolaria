import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../mock-tauri'
import { cleanupTauriEventListener } from '../utils/tauriEventCleanup'
import { notePathsMatch } from '../utils/notePathIdentity'
import { renameToastMessage, reloadTabsAfterRename } from './useNoteRename'

/** Matches the Rust backend's `wikilinks-rewrite-completed` event constant
 *  (see src-tauri/src/commands/vault/rename_cmds.rs). */
export const WIKILINK_REWRITE_COMPLETED_EVENT = 'wikilinks-rewrite-completed'

/** Mirrors the Rust `WikilinkRewriteCompleted` struct — plain snake_case,
 *  matching this backend's convention for rename-result-shaped payloads. */
interface WikilinkRewriteCompletedPayload {
  old_path: string
  new_path: string
  updated_files: number
  failed_updates: number
  updated_paths: string[]
}

interface Tab {
  entry: { path: string }
  content: string
}

interface UseWikilinkRewriteNotificationsOptions {
  tabs: Tab[]
  updateTabContent: (path: string, content: string) => void
  isPathUnsaved?: (path: string) => boolean
  setToastMessage: (msg: string | null) => void
  /** Re-parse just these notes from disk (their wikilinks changed) instead of
   *  rescanning the whole vault. Falls back to reloadVault when absent. */
  refreshEntries?: (paths: string[]) => void | Promise<unknown>
  reloadVault?: () => Promise<unknown>
}

/**
 * A rename's own file move returns immediately; the vault-wide wikilink
 * rewrite for every *other* note that linked it runs afterward as a
 * background job (see PendingWikilinkRewrite::run on the Rust side) and
 * reports its result via this event once it's done. This only needs to
 * refresh the content of any *currently open* tab among the rewritten
 * notes — the vault file watcher already picks up the on-disk changes for
 * everything else (entries, search index, etc.).
 */
export function useWikilinkRewriteNotifications({
  tabs,
  updateTabContent,
  isPathUnsaved,
  setToastMessage,
  refreshEntries,
  reloadVault,
}: UseWikilinkRewriteNotificationsOptions): void {
  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  const updateTabContentRef = useRef(updateTabContent)
  useEffect(() => { updateTabContentRef.current = updateTabContent }, [updateTabContent])
  const isPathUnsavedRef = useRef(isPathUnsaved)
  useEffect(() => { isPathUnsavedRef.current = isPathUnsaved }, [isPathUnsaved])
  const setToastMessageRef = useRef(setToastMessage)
  useEffect(() => { setToastMessageRef.current = setToastMessage }, [setToastMessage])
  const refreshEntriesRef = useRef(refreshEntries)
  useEffect(() => { refreshEntriesRef.current = refreshEntries }, [refreshEntries])
  const reloadVaultRef = useRef(reloadVault)
  useEffect(() => { reloadVaultRef.current = reloadVault }, [reloadVault])

  useEffect(() => {
    if (!isTauri()) return

    let cancelled = false
    let unlisten: UnlistenFn | null = null

    void listen<WikilinkRewriteCompletedPayload>(WIKILINK_REWRITE_COMPLETED_EVENT, (event) => {
      const { updated_files, failed_updates, updated_paths } = event.payload
      if (updated_files === 0 && failed_updates === 0) return

      const openRewrittenPaths = tabsRef.current
        .map((tab) => tab.entry.path)
        .filter((path) => updated_paths.some((updatedPath) => notePathsMatch(updatedPath, path)))
      void reloadTabsAfterRename({
        tabPaths: openRewrittenPaths,
        updateTabContent: updateTabContentRef.current,
        isPathUnsaved: isPathUnsavedRef.current,
      })

      if (refreshEntriesRef.current) {
        void refreshEntriesRef.current(updated_paths)
      } else if (reloadVaultRef.current) {
        void reloadVaultRef.current()
      }

      setToastMessageRef.current(renameToastMessage(updated_files, failed_updates))
    }).then((nextUnlisten) => {
      if (cancelled) cleanupTauriEventListener(nextUnlisten)
      else unlisten = nextUnlisten
    }).catch((err) => {
      console.warn('Failed to subscribe to wikilink rewrite events:', err)
    })

    return () => {
      cancelled = true
      if (unlisten) cleanupTauriEventListener(unlisten)
    }
  }, [])
}
