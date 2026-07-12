import { startTransition, useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useEditorSaveWithLinks } from './useEditorSaveWithLinks'
import { UNTITLED_RENAME_DEBOUNCE_MS } from './editorSaveTiming'
import { cacheNoteContent } from './useTabManagement'
import { flushEditorContent } from '../utils/autoSave'
import { extractH1TitleFromContent } from '../utils/noteTitle'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { canWritePathToVault } from '../utils/vaultPathContainment'
import { vaultPathForEntry } from '../utils/workspaces'

interface TabState {
  entry: VaultEntry
  content: string
}

interface PendingUntitledRename {
  path: string
  title: string
  timer: ReturnType<typeof setTimeout>
}

/**
 * In-flight auto-renames, keyed by the note's pre-rename path. Used to (a)
 * dedupe concurrent rename attempts for the same note, and (b) let a save
 * that's about to persist a note mid-rename wait for the rename's actual
 * result instead of writing under a path that's about to stop existing.
 */
type InFlightRenameMap = Map<string, Promise<string>>

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

function isUntitledRenameCandidate(path: string): boolean {
  const filename = path.split('/').pop() ?? ''
  const stem = filename.replace(/\.md$/, '')
  return stem.startsWith('untitled-') && /\d+$/.test(stem)
}

function schedulableUntitledRenameTitle({
  path,
  content,
  initialH1AutoRenameEnabled,
}: {
  path: string
  content: string
  initialH1AutoRenameEnabled: boolean
}): string | null {
  if (!isTauri() || !initialH1AutoRenameEnabled || !isUntitledRenameCandidate(path)) return null
  return extractH1TitleFromContent(content)
}

function matchingPendingRename({
  pending,
  path,
}: {
  pending: PendingUntitledRename | null
  path?: string
},
): PendingUntitledRename | null {
  if (!pending) return null
  if (path && pending.path !== path) return null
  return pending
}

function takePendingRename({
  pendingRenameRef,
  path,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  path?: string
},
): PendingUntitledRename | null {
  const pending = matchingPendingRename({ pending: pendingRenameRef.current, path })
  if (!pending) return null
  clearTimeout(pending.timer)
  pendingRenameRef.current = null
  return pending
}

function schedulePendingRename({
  pendingRenameRef,
  path,
  title,
  onFire,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  path: string
  title: string
  onFire: (path: string) => void
},
): void {
  const currentPending = pendingRenameRef.current
  if (currentPending?.path === path && currentPending.title === title) return
  takePendingRename({ pendingRenameRef })
  const timer = setTimeout(() => {
    const pending = takePendingRename({ pendingRenameRef, path })
    if (pending) onFire(pending.path)
  }, UNTITLED_RENAME_DEBOUNCE_MS)
  pendingRenameRef.current = { path, title, timer }
}

function pendingRenameOutsideActiveTab({
  pendingRenameRef,
  activeTabPath,
}: {
  pendingRenameRef: MutableRefObject<PendingUntitledRename | null>
  activeTabPath: string | null
},
): string | null {
  const pending = pendingRenameRef.current
  if (!pending || pending.path === activeTabPath) return null
  return pending.path
}

async function reloadAutoRenamedNote(
  {
    oldPath,
    newPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
  }: {
    oldPath: string
    newPath: string
    tabsRef: MutableRefObject<TabState[]>
    activeTabPathRef: MutableRefObject<string | null>
    setTabs: AppSaveDeps['setTabs']
    handleSwitchTab: AppSaveDeps['handleSwitchTab']
    replaceEntry: AppSaveDeps['replaceEntry']
    loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  },
): Promise<void> {
  const newEntry = await invoke<VaultEntry>('reload_vault_entry', { path: newPath })
  const preservedContent = tabsRef.current.find((tab) => tab.entry.path === oldPath)?.content
    ?? await invoke<string>('get_note_content', { path: newPath })

  startTransition(() => {
    setTabs((prev: TabState[]) => prev.map((tab) => (
      tab.entry.path === oldPath
        ? { entry: { ...tab.entry, ...newEntry, path: newPath }, content: preservedContent }
        : tab
    )))
    if (activeTabPathRef.current === oldPath) handleSwitchTab(newPath)
    replaceEntry(oldPath, { ...newEntry, path: newPath }, preservedContent)
    loadModifiedFiles()
  })
}

function useCurrentValueRef<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

function useUntitledRenameExecutor({
  resolvedPath,
  tabsRef,
  activeTabPathRef,
  setTabs,
  handleSwitchTab,
  replaceEntry,
  loadModifiedFiles,
  onInternalVaultWrite,
  inFlightUntitledRenameRef,
  remapPendingContentPathRef,
}: {
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  activeTabPathRef: MutableRefObject<string | null>
  setTabs: AppSaveDeps['setTabs']
  handleSwitchTab: AppSaveDeps['handleSwitchTab']
  replaceEntry: AppSaveDeps['replaceEntry']
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
  inFlightUntitledRenameRef: MutableRefObject<InFlightRenameMap>
  remapPendingContentPathRef: MutableRefObject<(oldPath: string, newPath: string) => void>
}) {
  return useCallback(async (path: string) => {
    const existingRename = inFlightUntitledRenameRef.current.get(path)
    if (existingRename) return (await existingRename) !== path

    const renamePromise = (async () => {
      try {
        const renameVaultPath = vaultPathForTabPath(tabsRef.current, path, resolvedPath)
        const result = await invoke<{ new_path: string; updated_files: number } | null>('auto_rename_untitled', {
          args: { vaultPath: renameVaultPath, notePath: path },
        })
        if (!result) return path
        onInternalVaultWrite?.(path)
        onInternalVaultWrite?.(result.new_path)
        remapPendingContentPathRef.current(path, result.new_path)
        await reloadAutoRenamedNote({
          oldPath: path,
          newPath: result.new_path,
          tabsRef,
          activeTabPathRef,
          setTabs,
          handleSwitchTab,
          replaceEntry,
          loadModifiedFiles,
        })
        return result.new_path
      } catch {
        return path
      } finally {
        inFlightUntitledRenameRef.current.delete(path)
      }
    })()

    inFlightUntitledRenameRef.current.set(path, renamePromise)
    return (await renamePromise) !== path
  }, [
    resolvedPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
    onInternalVaultWrite,
    inFlightUntitledRenameRef,
    remapPendingContentPathRef,
  ])
}

function useUntitledRenameScheduler({
  executeUntitledRename,
  initialH1AutoRenameEnabled,
}: {
  executeUntitledRename: (path: string) => Promise<boolean>
  initialH1AutoRenameEnabled: boolean
}) {
  const pendingUntitledRenameRef = useRef<PendingUntitledRename | null>(null)

  const cancelPendingUntitledRename = useCallback((path?: string) => (
    takePendingRename({ pendingRenameRef: pendingUntitledRenameRef, path }) !== null
  ), [])

  const flushPendingUntitledRename = useCallback(async (path?: string) => {
    const pending = takePendingRename({ pendingRenameRef: pendingUntitledRenameRef, path })
    if (!pending) return false
    return executeUntitledRename(pending.path)
  }, [executeUntitledRename])

  const scheduleUntitledRename = useCallback((path: string, content: string) => {
    const title = schedulableUntitledRenameTitle({ path, content, initialH1AutoRenameEnabled })
    if (!title) {
      cancelPendingUntitledRename(path)
      return
    }

    schedulePendingRename({
      pendingRenameRef: pendingUntitledRenameRef,
      path,
      title,
      onFire: (pendingPath) => {
        void executeUntitledRename(pendingPath)
      },
    })
  }, [cancelPendingUntitledRename, executeUntitledRename, initialH1AutoRenameEnabled])

  const refreshPendingUntitledRename = useCallback((path: string, content: string) => {
    if (!matchingPendingRename({ pending: pendingUntitledRenameRef.current, path })) return
    scheduleUntitledRename(path, content)
  }, [scheduleUntitledRename])

  return {
    pendingUntitledRenameRef,
    cancelPendingUntitledRename,
    flushPendingUntitledRename,
    refreshPendingUntitledRename,
    scheduleUntitledRename,
  }
}

function useUntitledRenameCoordinator({
  resolvedPath,
  tabsRef,
  activeTabPathRef,
  setTabs,
  handleSwitchTab,
  replaceEntry,
  loadModifiedFiles,
  onInternalVaultWrite,
  initialH1AutoRenameEnabled,
  remapPendingContentPathRef,
}: {
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  activeTabPathRef: MutableRefObject<string | null>
  setTabs: AppSaveDeps['setTabs']
  handleSwitchTab: AppSaveDeps['handleSwitchTab']
  replaceEntry: AppSaveDeps['replaceEntry']
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  onInternalVaultWrite?: AppSaveDeps['onInternalVaultWrite']
  initialH1AutoRenameEnabled: boolean
  remapPendingContentPathRef: MutableRefObject<(oldPath: string, newPath: string) => void>
}) {
  const inFlightUntitledRenameRef = useRef<InFlightRenameMap>(new Map())
  const executeUntitledRename = useUntitledRenameExecutor({
    resolvedPath,
    tabsRef,
    activeTabPathRef,
    setTabs,
    handleSwitchTab,
    replaceEntry,
    loadModifiedFiles,
    onInternalVaultWrite,
    inFlightUntitledRenameRef,
    remapPendingContentPathRef,
  })
  const {
    pendingUntitledRenameRef,
    cancelPendingUntitledRename,
    flushPendingUntitledRename,
    refreshPendingUntitledRename,
    scheduleUntitledRename,
  } = useUntitledRenameScheduler({ executeUntitledRename, initialH1AutoRenameEnabled })

  // A save that's about to persist a path with an in-flight auto-rename waits
  // for that rename's actual result instead of writing under a path that's
  // about to stop existing. No map, no chain: auto-renames are one-shot, so
  // there's never more than this single hop to wait for.
  const resolvePathBeforeSave = useCallback((path: string) => (
    inFlightUntitledRenameRef.current.get(path) ?? Promise.resolve(path)
  ), [inFlightUntitledRenameRef])

  return {
    pendingUntitledRenameRef,
    cancelPendingUntitledRename,
    resolvePathBeforeSave,
    flushPendingUntitledRename,
    refreshPendingUntitledRename,
    scheduleUntitledRename,
  }
}

interface AppSaveDeps {
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  setTabs: Parameters<typeof useEditorSaveWithLinks>[0]['setTabs']
  handleSwitchTab: (path: string) => void
  setToastMessage: (msg: string | null) => void
  loadModifiedFiles: () => void
  reloadViews?: () => Promise<void>
  trackUnsaved?: (path: string) => void
  clearUnsaved: (path: string) => void
  unsavedPaths: Set<string>
  tabs: TabState[]
  activeTabPath: string | null
  handleRenameNote: (path: string, newTitle: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => Promise<void>
  handleRenameFilename: (path: string, newFilenameStem: string, vaultPath: string, onEntryRenamed: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void) => Promise<void>
  replaceEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  resolvedPath: string
  writableVaultPaths?: readonly string[]
  initialH1AutoRenameEnabled: boolean
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
  refreshPendingUntitledRename: (path: string, content: string) => void
  scheduleUntitledRename: (path: string, content: string) => void
  resolvePathBeforeSave: (path: string) => Promise<string>
  canPersist: boolean
  persistenceScope: string | readonly string[]
  locale: AppLocale
}

function useAppSaveStateRefs({
  tabs,
  activeTabPath,
  unsavedPaths,
}: Pick<AppSaveDeps, 'tabs' | 'activeTabPath' | 'unsavedPaths'>) {
  return {
    tabsRef: useCurrentValueRef(tabs),
    activeTabPathRef: useCurrentValueRef(activeTabPath),
    unsavedPathsRef: useCurrentValueRef(unsavedPaths),
  }
}

function useAppSaveEffects({
  contentChangeRef,
  handleContentChange,
  cancelPendingUntitledRename,
  pendingUntitledRenameRef,
  activeTabPath,
}: {
  contentChangeRef: MutableRefObject<(path: string, content: string) => void>
  handleContentChange: (path: string, content: string) => void
  cancelPendingUntitledRename: (path?: string) => boolean
  pendingUntitledRenameRef: MutableRefObject<PendingUntitledRename | null>
  activeTabPath: string | null
}) {
  useEffect(() => { contentChangeRef.current = handleContentChange }, [contentChangeRef, handleContentChange])
  useEffect(() => () => { cancelPendingUntitledRename() }, [cancelPendingUntitledRename])
  useEffect(() => {
    const pendingPath = pendingRenameOutsideActiveTab({
      pendingRenameRef: pendingUntitledRenameRef,
      activeTabPath,
    })
    if (pendingPath) cancelPendingUntitledRename(pendingPath)
  }, [activeTabPath, cancelPendingUntitledRename, pendingUntitledRenameRef])
}

function useFlushBeforeAction({
  canPersist,
  savePendingForPath,
  tabsRef,
  unsavedPathsRef,
  clearUnsaved,
  setToastMessage,
  flushPendingUntitledRename,
  locale,
}: {
  canPersist: boolean
  savePendingForPath: (path: string) => Promise<boolean>
  tabsRef: MutableRefObject<TabState[]>
  unsavedPathsRef: MutableRefObject<Set<string>>
  clearUnsaved: AppSaveDeps['clearUnsaved']
  setToastMessage: AppSaveDeps['setToastMessage']
  flushPendingUntitledRename: (path?: string) => Promise<boolean>
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
      await flushPendingUntitledRename(path)
    } catch (err) {
      setToastMessage(t('save.error.autoFailed', { error: String(err) }))
      throw err
    }
  }, [canPersist, savePendingForPath, tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, flushPendingUntitledRename, t])
}

async function preparePathForManualRename({
  path,
  savePendingForPath,
  cancelPendingUntitledRename,
}: {
  path: string
  savePendingForPath: (path: string) => Promise<boolean>
  cancelPendingUntitledRename: (path?: string) => boolean
}): Promise<void> {
  await savePendingForPath(path)
  cancelPendingUntitledRename(path)
}

function useRenameHandlers({
  savePendingForPath,
  cancelPendingUntitledRename,
  handleRenameNote,
  handleRenameFilename,
  resolvedPath,
  tabsRef,
  replaceRenamedEntry,
  loadModifiedFiles,
}: {
  savePendingForPath: (path: string) => Promise<boolean>
  cancelPendingUntitledRename: (path?: string) => boolean
  handleRenameNote: AppSaveDeps['handleRenameNote']
  handleRenameFilename: AppSaveDeps['handleRenameFilename']
  resolvedPath: string
  tabsRef: MutableRefObject<TabState[]>
  replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
}) {
  const handleFilenameRename = useCallback(async (path: string, newFilenameStem: string) => {
    await preparePathForManualRename({ path, savePendingForPath, cancelPendingUntitledRename })
    const renameVaultPath = vaultPathForTabPath(tabsRef.current, path, resolvedPath)
    await handleRenameFilename(path, newFilenameStem, renameVaultPath, replaceRenamedEntry).then(loadModifiedFiles)
  }, [savePendingForPath, cancelPendingUntitledRename, tabsRef, resolvedPath, handleRenameFilename, replaceRenamedEntry, loadModifiedFiles])

  const handleTitleSync = useCallback((path: string, newTitle: string) => {
    void preparePathForManualRename({ path, savePendingForPath, cancelPendingUntitledRename })
      .then(() => {
        const renameVaultPath = vaultPathForTabPath(tabsRef.current, path, resolvedPath)
        return handleRenameNote(path, newTitle, renameVaultPath, replaceRenamedEntry)
      })
      .then(loadModifiedFiles)
      .catch((err) => console.error('Title rename failed:', err))
  }, [savePendingForPath, cancelPendingUntitledRename, tabsRef, resolvedPath, handleRenameNote, replaceRenamedEntry, loadModifiedFiles])

  return { handleFilenameRename, handleTitleSync }
}

function useHandleSaveAction({
  handleSaveRaw,
  tabs,
  activeTabPath,
  unsavedPaths,
  flushPendingUntitledRename,
}: {
  handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
  tabs: TabState[]
  activeTabPath: string | null
  unsavedPaths: Set<string>
  flushPendingUntitledRename: (path?: string) => Promise<boolean>
}) {
  return useCallback(async () => {
    const saveCompleted = await handleSaveRaw(findUnsavedFallback({ tabs, activeTabPath, unsavedPaths }))
    if (!saveCompleted) return false
    await flushPendingUntitledRename(activeTabPath ?? undefined)
    return true
  }, [handleSaveRaw, tabs, activeTabPath, unsavedPaths, flushPendingUntitledRename])
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
  refreshPendingUntitledRename,
  scheduleUntitledRename,
  resolvePathBeforeSave,
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
    scheduleUntitledRename(path, content)
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
  }, [clearUnsaved, onInternalVaultWrite, refreshEntries, reloadViews, scheduleUntitledRename])

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
    resolvePathBeforeSave,
    canPersist,
    persistenceScope,
    locale,
  })

  const handleContentChange = useCallback((path: string, content: string) => {
    if (!canWritePathToVault(path, persistenceScope)) return
    refreshPendingUntitledRename(path, content)
    trackUnsaved?.(path)
    handleContentChangeRaw(path, content)
  }, [handleContentChangeRaw, persistenceScope, refreshPendingUntitledRename, trackUnsaved])

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
  cancelPendingUntitledRename,
  pendingUntitledRenameRef,
  activeTabPath,
  savePendingForPath,
  tabsRef,
  unsavedPathsRef,
  clearUnsaved,
  setToastMessage,
  flushPendingUntitledRename,
  locale,
  handleRenameNote,
  handleRenameFilename,
  resolvedPath,
  replaceRenamedEntry,
  loadModifiedFiles,
  handleSaveRaw,
  tabs,
  unsavedPaths,
}: {
  contentChangeRef: MutableRefObject<(path: string, content: string) => void>
  handleContentChange: (path: string, content: string) => void
  canPersist: boolean
  cancelPendingUntitledRename: (path?: string) => boolean
  pendingUntitledRenameRef: MutableRefObject<PendingUntitledRename | null>
  activeTabPath: string | null
  savePendingForPath: (path: string) => Promise<boolean>
  tabsRef: MutableRefObject<TabState[]>
  unsavedPathsRef: MutableRefObject<Set<string>>
  clearUnsaved: AppSaveDeps['clearUnsaved']
  setToastMessage: AppSaveDeps['setToastMessage']
  flushPendingUntitledRename: (path?: string) => Promise<boolean>
  locale: AppLocale
  handleRenameNote: AppSaveDeps['handleRenameNote']
  handleRenameFilename: AppSaveDeps['handleRenameFilename']
  resolvedPath: string
  replaceRenamedEntry: (oldPath: string, newEntry: Partial<VaultEntry> & { path: string }, newContent: string) => void
  loadModifiedFiles: AppSaveDeps['loadModifiedFiles']
  handleSaveRaw: (unsavedFallback?: { path: string; content: string }) => Promise<boolean>
  tabs: TabState[]
  unsavedPaths: Set<string>
}) {
  useAppSaveEffects({
    contentChangeRef,
    handleContentChange,
    cancelPendingUntitledRename,
    pendingUntitledRenameRef,
    activeTabPath,
  })

  const flushBeforeAction = useFlushBeforeAction({
    canPersist,
    savePendingForPath,
    tabsRef,
    unsavedPathsRef,
    clearUnsaved,
    setToastMessage,
    flushPendingUntitledRename,
    locale,
  })
  const { handleFilenameRename, handleTitleSync } = useRenameHandlers({
    savePendingForPath,
    cancelPendingUntitledRename,
    handleRenameNote,
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
    flushPendingUntitledRename,
  })

  return { handleFilenameRename, handleSave, handleTitleSync, flushBeforeAction }
}

export function useAppSave({
  updateEntry, setTabs, handleSwitchTab, setToastMessage, loadModifiedFiles,
  reloadViews, trackUnsaved, clearUnsaved, unsavedPaths, tabs, activeTabPath,
  handleRenameNote, handleRenameFilename: handleRenameFilenameRaw, replaceEntry,
  resolvedPath, writableVaultPaths, initialH1AutoRenameEnabled, onInternalVaultWrite,
  refreshEntries,
  locale = 'en',
}: AppSaveDeps) {
  const contentChangeRef = useRef<(path: string, content: string) => void>(() => {})
  const canPersist = resolvedPath.trim().length > 0
  const { tabsRef, activeTabPathRef, unsavedPathsRef } = useAppSaveStateRefs({ tabs, activeTabPath, unsavedPaths })
  // useEditorPersistence (constructed below) is where remapPendingContentPath
  // actually lives, but the untitled-rename executor (constructed first, since
  // its scheduleUntitledRename/refreshPendingUntitledRename feed the opposite
  // direction into useEditorPersistence) needs to call it too. Break the cycle
  // with a ref, populated once useEditorPersistence exists.
  const remapPendingContentPathRef = useRef<(oldPath: string, newPath: string) => void>(() => {})
  const {
    pendingUntitledRenameRef, cancelPendingUntitledRename,
    resolvePathBeforeSave, flushPendingUntitledRename,
    refreshPendingUntitledRename, scheduleUntitledRename,
  } = useUntitledRenameCoordinator({
    resolvedPath, tabsRef, activeTabPathRef, setTabs, handleSwitchTab,
    replaceEntry, loadModifiedFiles, onInternalVaultWrite, initialH1AutoRenameEnabled,
    remapPendingContentPathRef,
  })
  const { handleSaveRaw, handleContentChange, savePendingForPath, savePending, remapPendingContentPath } = useEditorPersistence({
    updateEntry, setTabs, setToastMessage, loadModifiedFiles, trackUnsaved,
    clearUnsaved, onInternalVaultWrite, refreshEntries, reloadViews, refreshPendingUntitledRename, scheduleUntitledRename,
    resolvePathBeforeSave, canPersist,
    persistenceScope: writableVaultPaths && writableVaultPaths.length > 0 ? writableVaultPaths : resolvedPath,
    locale,
  })
  useEffect(() => {
    remapPendingContentPathRef.current = remapPendingContentPath
  }, [remapPendingContentPath])
  const replaceRenamedEntry = useReplaceRenamedEntry({ remapPendingContentPath, replaceEntry })
  const { handleFilenameRename, handleSave, handleTitleSync, flushBeforeAction } = useAppSaveHandlers({
    contentChangeRef, handleContentChange, canPersist, cancelPendingUntitledRename,
    pendingUntitledRenameRef, activeTabPath, savePendingForPath,
    tabsRef, unsavedPathsRef, clearUnsaved, setToastMessage, flushPendingUntitledRename, locale, handleRenameNote,
    handleRenameFilename: handleRenameFilenameRaw,
    resolvedPath, replaceRenamedEntry, loadModifiedFiles, handleSaveRaw, tabs, unsavedPaths,
  })

  return {
    contentChangeRef, handleContentChange, handleFilenameRename, handleSave,
    handleTitleSync, savePending, savePendingForPath, trackRenamedPath: remapPendingContentPath, flushBeforeAction,
  }
}
