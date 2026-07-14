import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useEditorSaveWithLinks } from './useEditorSaveWithLinks'
import { cacheNoteContent } from './useTabManagement'
import { flushEditorContent } from '../utils/autoSave'
import type { VaultEntry } from '../types'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'
import { vaultPathForEntry } from '../utils/workspaces'

interface TabState {
  entry: VaultEntry
  content: string
}

function vaultPathForTabPath(tabs: TabState[], path: string, fallbackVaultPath: string): string {
  const tab = tabs.find((candidate) => candidate.entry.path === path)
  return tab ? vaultPathForEntry(tab.entry, fallbackVaultPath) : fallbackVaultPath
}

function findUnsavedFallback({
  tabs,
  activeTabPath,
  unsavedPaths,
}: {
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
}): { path: string; content: string } | undefined {
  const activeTab = tabs.find(t => t.entry.path === activeTabPath)
  if (!activeTab || !unsavedPaths.has(activeTab.entry.path)) return undefined
  return { path: activeTab.entry.path, content: activeTab.content }
}

function useCurrentValueRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

interface AppSaveDeps {
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  setTabs: Parameters<typeof useEditorSaveWithLinks>[0]['setTabs']
  setToastMessage: (msg: string | null) => void
  loadModifiedFiles: () => void
  reloadViews?: () => Promise<void>
  trackUnsaved?: (path: string) => void
  clearUnsaved: (path: string) => void
  unsavedPaths: Set<string>
  tabs: TabState[]
  activeTabPath: string | null
  handleRenameFilename: (path: string, newFilenameStem: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => Promise<void>
  replaceEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  resolvedPath: string
  writableVaultPaths?: readonly string[]
  onInternalVaultWrite?: (path: string) => void
  refreshEntries?: (paths: string[]) => Promise<Array<VaultEntry | null> | void>
  locale?: AppLocale
}

interface EditorPersistenceOptions {
  updateEntry: AppSaveDeps['updateEntry']
  setTabs: AppSaveDeps['setTabs']
  setToastMessage: AppSaveDeps['setToastMessage']
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  trackUnsaved?: AppSaveDeps['trackUnsaved']
  clearUnsaved: AppSaveDeps['clearUnsaved']
  onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
  refreshEntries?: AppSaveDeps['refreshEntries']
  reloadViews: AppSaveDeps['reloadViews']
  canPersist: boolean
  persistenceScope: string | readonly string[]
  locale: AppLocale
}

function useAppSaveStateRefs({
  tabs,
  unsavedPaths,
}: Pick<AppSaveDeps, 'tabs' | 'unsavedPaths'>) {
  return {
    tabsRef: useCurrentValueRef(tabs),
    unsavedPathsRef: useCurrentValueRef(unsavedPaths),
  }
}

function useAppSaveEffects({
  contentChangeRef,
  handleContentChange,
}: {
  contentChangeRef: MutableRefObject<(path: string, content: string) => void>
  handleContentChange: (path: string, content: string) => void
}) {
  useEffect(() => { contentChangeRef.current = handleContentChange }, [contentChangeRef, handleContentChange])
}

function useFlushBeforeAction({
  canPersist,
  savePendingForPath,
  tabsRef,
  unsavedPathsRef,
  clearUnsaved,
  setToastMessage,
  locale,
}: {
  canPersist: boolean
  savePendingForPath: (path: string) => Promise<boolean>
  tabsRef: MutableRefObject<TabState[]>
  unsavedPathsRef: MutableRefObject<Set<string>>
  clearUnsaved: AppSaveDeps['clearUnsaved']
  setToastMessage: AppSaveDeps['setToastMessage']
  locale: AppLocale
}) {
  const t = useMemo(() => createTranslator(locale), [locale])

  return useCallback(async (path: string) => {
    if (!canPersist) {
      if (unsavedPathsRef.current.has(path)) setToastMessage(t('save.toast.missingActiveVault'))
      return
    }
    try {
      await flushEditorContent(path, {
        savePendingForPath,
        getTabContent: (p) => tabsRef.current.find(t => t.entry.path === p)?.content,
        isUnsaved: (p) => unsavedPathsRef.current.has(p),
        onSaved: (p) => { clearUnsaved(p) },
      })
    } catch (err) {
      setToastMessage(t('save.error.autoFailed', { error: String(err) }))
      throw err
    }
  }, [canPersist, savePendingForPath, tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, t])
}

function useRenameHandlers({
  savePendingForPath,
  handleRenameFilename,
  resolvedPath,
  tabsRef,
  replaceRenamedEntry,
  loadModifiedFiles,
}: {
  savePendingForPath: (path: string) => Promise<boolean>
  handleRenameFilename: AppSaveDeps['handleRenameFilename']
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
}) {
  const handleFilenameRename = useCallback(async (path: string, newFilenameStem: string) => {
    await savePendingForPath(path)
    const renameVaultPath = vaultPathForTabPath(tabsRef.current, path, resolvedPath)
    await handleRenameFilename(path, newFilenameStem, renameVaultPath, replaceRenamedEntry).then(loadModifiedFiles)
  }, [savePendingForPath, tabsRef, resolvedPath, handleRenameFilename, replaceRenamedEntry, loadModifiedFiles])

  return { handleFilenameRename }
}

function useHandleSaveAction({
  handleSaveRaw,
  tabs,
  activeTabPath,
  unsavedPaths,
}: {
  handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
}) {
  return useCallback(async () => (
    handleSaveRaw(findUnsavedFallback({ tabs, activeTabPath, unsavedPaths }))
  ), [handleSaveRaw, tabs, activeTabPath, unsavedPaths])
}

function useEditorPersistence({
  updateEntry,
  setTabs,
  setToastMessage,
  loadModifiedFiles,
  trackUnsaved,
  clearUnsaved,
  onInternalVaultWrite,
  refreshEntries,
  reloadViews,
  canPersist,
  persistenceScope,
  locale,
}: EditorPersistenceOptions) {
  const onAfterSave = useCallback(() => {
    loadModifiedFiles()
  }, [loadModifiedFiles])

  // `save_note_content` stamps derived frontmatter (`modified`, `codeBlocks`) on
  // the write path, so the content the editor shows is untouched — but the
  // in-memory entry's `properties` are now stale. Re-read the entry from disk so
  // those derived fields stay searchable without waiting for a full rescan.
  const persistStampSeqRef = useRef(new Map<string, number>())

  const onNotePersisted = useCallback((path: string, content: string) => {
    onInternalVaultWrite?.(path)
    clearUnsaved(path)
    if (path.endsWith('.yml')) reloadViews?.()
    // Re-stamp the in-memory content cache with the refreshed on-disk identity
    // so revisiting an edited note trusts memory instead of re-reading disk.
    // The sequence guard keeps an out-of-order refresh from stamping content
    // that a newer save has already superseded.
    const stampSeq = (persistStampSeqRef.current.get(path) ?? 0) + 1
    persistStampSeqRef.current.set(path, stampSeq)
    void refreshEntries?.([path]).then((refreshed) => {
      if (persistStampSeqRef.current.get(path) !== stampSeq) return
      const freshEntry = Array.isArray(refreshed)
        ? refreshed.find((candidate) => candidate && candidate.path === path)
        : null
      if (freshEntry) cacheNoteContent(path, content, freshEntry)
    })
  }, [clearUnsaved, onInternalVaultWrite, refreshEntries, reloadViews])

  const {
    handleSave: handleSaveRaw,
    handleContentChange: handleContentChangeRaw,
    savePendingForPath: savePendingForPathRaw,
    savePending,
    remapPendingContentPath,
  } = useEditorSaveWithLinks({
    updateEntry,
    setTabs,
    setToastMessage,
    onAfterSave,
    onBeforePersist: onInternalVaultWrite,
    onNotePersisted,
    canPersist,
    persistenceScope,
    locale,
  })

  const handleContentChange = useCallback((path: string, content: string) => {
    if (!canWritePathToVault(path, persistenceScope)) return
    trackUnsaved?.(path)
    handleContentChangeRaw(path, content)
  }, [handleContentChangeRaw, persistenceScope, trackUnsaved])

  return { handleSaveRaw, handleContentChange, savePendingForPath: savePendingForPathRaw, savePending, remapPendingContentPath }
}

function useReplaceRenamedEntry({
  remapPendingContentPath,
  replaceEntry,
}: {
  remapPendingContentPath: (oldPath: string, newPath: string) => void
  replaceEntry: AppSaveDeps['replaceEntry']
}) {
  return useCallback((oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => {
    remapPendingContentPath(oldPath, newEntry.path)
    replaceEntry(oldPath, newEntry, newContent)
  }, [remapPendingContentPath, replaceEntry])
}

function useAppSaveHandlers({
  contentChangeRef,
  handleContentChange,
  canPersist,
  savePendingForPath,
  tabsRef,
  unsavedPathsRef,
  clearUnsaved,
  setToastMessage,
  locale,
  handleRenameFilename,
  resolvedPath,
  replaceRenamedEntry,
  loadModifiedFiles,
  handleSaveRaw,
  tabs,
  activeTabPath,
  unsavedPaths,
}: {
  contentChangeRef: MutableRefObject<(path: string, content: string) => void>
  handleContentChange: (path: string, content: string) => void
  canPersist: boolean
  savePendingForPath: (path: string) => Promise<boolean>
  tabsRef: MutableRefObject<TabState[]>
  unsavedPathsRef: MutableRefObject<Set<string>>
  clearUnsaved: AppSaveDeps['clearUnsaved']
  setToastMessage: AppSaveDeps['setToastMessage']
  locale: AppLocale
  handleRenameFilename: AppSaveDeps['handleRenameFilename']
  resolvedPath: string
  replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
}) {
  useAppSaveEffects({ contentChangeRef, handleContentChange })

  const flushBeforeAction = useFlushBeforeAction({
    canPersist,
    savePendingForPath,
    tabsRef,
    unsavedPathsRef,
    clearUnsaved,
    setToastMessage,
    locale,
  })
  const { handleFilenameRename } = useRenameHandlers({
    savePendingForPath,
    handleRenameFilename,
    resolvedPath,
    tabsRef,
    replaceRenamedEntry,
    loadModifiedFiles,
  })
  const handleSave = useHandleSaveAction({
    handleSaveRaw,
    tabs,
    activeTabPath,
    unsavedPaths,
  })

  return { handleFilenameRename, handleSave, flushBeforeAction }
}

export function useAppSave({
  updateEntry, setTabs, setToastMessage, loadModifiedFiles,
  reloadViews, trackUnsaved, clearUnsaved, unsavedPaths, tabs, activeTabPath,
  handleRenameFilename, replaceEntry,
  resolvedPath, writableVaultPaths, onInternalVaultWrite,
  refreshEntries,
  locale = 'en',
}: AppSaveDeps) {
  const contentChangeRef = useRef<(path: string, content: string) => void>(() => {})
  const canPersist = resolvedPath.trim().length > 0
  const { tabsRef, unsavedPathsRef } = useAppSaveStateRefs({ tabs, unsavedPaths })
  const { handleSaveRaw, handleContentChange, savePendingForPath, savePending, remapPendingContentPath } = useEditorPersistence({
    updateEntry, setTabs, setToastMessage, loadModifiedFiles, trackUnsaved,
    clearUnsaved, onInternalVaultWrite, refreshEntries, reloadViews, canPersist,
    persistenceScope: writableVaultPaths && writableVaultPaths.length > 0 ? writableVaultPaths : resolvedPath,
    locale,
  })
  const replaceRenamedEntry = useReplaceRenamedEntry({ remapPendingContentPath, replaceEntry })
  const { handleFilenameRename, handleSave, flushBeforeAction } = useAppSaveHandlers({
    contentChangeRef, handleContentChange, canPersist, savePendingForPath,
    tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, locale,
    handleRenameFilename,
    resolvedPath, replaceRenamedEntry, loadModifiedFiles, handleSaveRaw, tabs, activeTabPath, unsavedPaths,
  })

  return {
    contentChangeRef, handleContentChange, handleFilenameRename, handleSave,
    savePending, savePendingForPath, trackRenamedPath: remapPendingContentPath, flushBeforeAction,
  }
}
