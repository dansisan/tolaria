import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { orphanedImageAttachments } from '../utils/attachmentPruning'
import { ATTACHMENTS_UNLINKED_EVENT } from './useSaveNote'
import { trackEvent } from '../lib/telemetry'

interface AttachmentsUnlinkedDetail {
  notePath: string
  removedLinks: string[]
}

interface UseAttachmentCleanupOptions {
  entries: VaultEntry[]
  vaultPath: string | undefined
  /** Records a path the app is about to write/delete so the vault watcher ignores
   *  the resulting filesystem event instead of reacting to our own change. */
  onInternalVaultWrite?: (path: string) => void
}

/**
 * Deletes image attachments whose last reference was just removed from a note.
 * Listens for the save-time `attachments-unlinked` event, keeps any image still
 * referenced by another note, and removes the rest from disk (best effort).
 */
export function useAttachmentCleanup({ entries, vaultPath, onInternalVaultWrite }: UseAttachmentCleanupOptions): void {
  const entriesRef = useRef(entries)
  useEffect(() => { entriesRef.current = entries }, [entries])

  const onInternalVaultWriteRef = useRef(onInternalVaultWrite)
  useEffect(() => { onInternalVaultWriteRef.current = onInternalVaultWrite }, [onInternalVaultWrite])

  useEffect(() => {
    if (!isTauri() || !vaultPath) return

    const handleUnlinked = (event: Event) => {
      const detail = (event as CustomEvent<AttachmentsUnlinkedDetail>).detail
      if (!detail) return
      const orphans = orphanedImageAttachments({
        removedLinks: detail.removedLinks,
        notePath: detail.notePath,
        entries: entriesRef.current,
      })
      if (orphans.length === 0) return
      trackEvent('attachment_pruned', { count: orphans.length })
      for (const attachmentPath of orphans) {
        // Mark the deletion as our own write *before* invoking it so the watcher's
        // suppression window already covers the filesystem event. Otherwise the
        // app reloads the vault — remounting the open editor — in reaction to a
        // change it caused itself.
        onInternalVaultWriteRef.current?.(`${vaultPath}/${attachmentPath}`)
        void invoke('delete_attachment', { vaultPath, attachmentPath }).catch(() => {
          // Best-effort cleanup: a failed delete just leaves an unused file behind.
        })
      }
    }

    window.addEventListener(ATTACHMENTS_UNLINKED_EVENT, handleUnlinked)
    return () => window.removeEventListener(ATTACHMENTS_UNLINKED_EVENT, handleUnlinked)
  }, [vaultPath])
}
