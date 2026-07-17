import { useCallback, useState } from 'react'
import type { SidebarSelection, VaultEntry } from '../../types'
import {
  clearDeletedFolderTabs,
  type ConfirmFolderDeleteState,
  type FolderTab,
  folderAbsolutePath,
  folderLabel,
  invokeDeleteFolder,
  resetSelectionIfFolderDeleted,
} from './folderActionUtils'

interface UseFolderDeleteInput {
  activeTabPathRef: React.MutableRefObject<string | null>
  clearFolderRename: () => void
  closeAllTabs: () => void
  /** Marks a path as a known-recent internal write so the vault file watcher's
   *  generic "unknown path changed" fallback doesn't redundantly rescan the
   *  whole vault a moment after a folder delete we already know about. */
  onInternalVaultWrite?: (path: string) => void
  reloadFolders: () => Promise<unknown>
  reloadVault: () => Promise<VaultEntry[]>
  selection: SidebarSelection
  setSelection: (selection: SidebarSelection) => void
  setTabs: React.Dispatch<React.SetStateAction<FolderTab[]>>
  setToastMessage: (message: string | null) => void
  vaultPath: string
}

export function useFolderDelete({
  activeTabPathRef,
  clearFolderRename,
  closeAllTabs,
  onInternalVaultWrite,
  reloadFolders,
  reloadVault,
  selection,
  setSelection,
  setTabs,
  setToastMessage,
  vaultPath,
}: UseFolderDeleteInput) {
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<ConfirmFolderDeleteState | null>(null)

  const requestDeleteFolder = useCallback((folderPath: string) => {
    clearFolderRename()
    setConfirmDeleteFolder({
      path: folderPath,
      title: `Delete "${folderLabel({ folderPath })}" and everything inside it?`,
      message: 'This permanently removes the folder, all nested folders, and every note or file inside it. This cannot be undone.',
      confirmLabel: 'Delete folder',
    })
  }, [clearFolderRename])

  const cancelDeleteFolder = useCallback(() => setConfirmDeleteFolder(null), [])

  const confirmDeleteSelectedFolder = useCallback(async () => {
    if (!confirmDeleteFolder) return

    const folderPath = confirmDeleteFolder.path
    try {
      setConfirmDeleteFolder(null)
      await invokeDeleteFolder({ vaultPath, folderPath })
      onInternalVaultWrite?.(folderAbsolutePath({ vaultPath, folderPath }))
      clearDeletedFolderTabs({
        activeTabPathRef,
        closeAllTabs,
        folderPath,
        setTabs,
        vaultPath,
      })
      await reloadFolders()
      const refreshedEntries = await reloadVault()
      resetSelectionIfFolderDeleted({
        folderPath,
        refreshedEntries,
        selection,
        setSelection,
        vaultPath,
      })
      setToastMessage(`Deleted folder "${folderLabel({ folderPath })}"`)
    } catch (error) {
      setToastMessage(`Failed to delete folder: ${error}`)
    }
  }, [activeTabPathRef, closeAllTabs, confirmDeleteFolder, onInternalVaultWrite, reloadFolders, reloadVault, selection, setSelection, setTabs, setToastMessage, vaultPath])

  const deleteSelectedFolder = useCallback(() => {
    if (selection.kind !== 'folder' || !selection.path) return
    requestDeleteFolder(selection.path)
  }, [requestDeleteFolder, selection])

  return {
    cancelDeleteFolder,
    confirmDeleteFolder,
    confirmDeleteSelectedFolder,
    deleteSelectedFolder,
    requestDeleteFolder,
  }
}
