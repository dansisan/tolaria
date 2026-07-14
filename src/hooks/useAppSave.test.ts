import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppSave } from './useAppSave'
import { AUTO_SAVE_DEBOUNCE_MS } from './editorSaveTiming'
import type { VaultEntry } from '../types'
import { isTauri } from '../mock-tauri'
import { invoke } from '@tauri-apps/api/core'
import { cacheNoteContent } from './useTabManagement'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./useTabManagement', async (importOriginal) => ({
  ...await importOriginal<typeof import('./useTabManagement')>(),
  cacheNoteContent: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  updateMockContent: vi.fn(),
}))

function makeEntry(path: string, title = 'Test', filename = 'test.md'): VaultEntry {
  return { path, title, filename, content: '', outgoingLinks: [], snippet: '', wordCount: 0, isA: 'Note', status: null, createdAt: null, modifiedAt: null, icon: null, tags: [] } as unknown as VaultEntry
}

function makeWorkspace(path: string, alias = 'workspace'): NonNullable<VaultEntry['workspace']> {
  return {
    id: alias,
    label: alias,
    alias,
    path,
    shortLabel: alias.slice(0, 2).toUpperCase(),
    color: null,
    icon: null,
    mounted: true,
    available: true,
    defaultForNewNotes: false,
  }
}

describe('useAppSave', () => {
  const deps = {
    updateEntry: vi.fn(),
    setTabs: vi.fn(),
    setToastMessage: vi.fn(),
    loadModifiedFiles: vi.fn(),
    onInternalVaultWrite: vi.fn(),
    trackUnsaved: vi.fn(),
    clearUnsaved: vi.fn(),
    unsavedPaths: new Set<string>(),
    tabs: [] as Array<{ entry: VaultEntry; content: string }>,
    activeTabPath: null as string | null,
    handleRenameFilename: vi.fn().mockResolvedValue(undefined),
    replaceEntry: vi.fn(),
    resolvedPath: '/vault',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.mocked(isTauri).mockReturnValue(false)
    deps.unsavedPaths = new Set()
    deps.tabs = []
    deps.activeTabPath = null
    deps.trackUnsaved.mockReset()
    deps.onInternalVaultWrite.mockReset()
    deps.handleRenameFilename.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderSave(overrides = {}) {
    return renderHook(() => useAppSave({ ...deps, ...overrides }))
  }

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
  }

  function renderMissingVaultDraft(path = 'C:\\Users\\Luca\\Notes\\draft.md') {
    vi.mocked(isTauri).mockReturnValue(true)
    const entry = makeEntry(path, 'Draft', 'draft.md')

    return {
      path,
      ...renderSave({
        resolvedPath: '',
        tabs: [{ entry, content: '# Draft\n\nBody' }],
        activeTabPath: path,
        unsavedPaths: new Set([path]),
      }),
    }
  }

  function renderAutoSaveScopeDraft({
    initialVaultPath,
    notePath,
  }: {
    initialVaultPath: string
    notePath: string
  }) {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)
    const entry = makeEntry(notePath, 'Draft', 'draft.md')
    const tabs = [{ entry, content: '# Draft' }]

    return {
      entry,
      ...renderHook(
        ({ vaultPath }: { vaultPath: string }) => useAppSave({
          ...deps,
          resolvedPath: vaultPath,
          tabs,
          activeTabPath: entry.path,
          unsavedPaths: new Set([entry.path]),
        }),
        { initialProps: { vaultPath: initialVaultPath } },
      ),
    }
  }

  function expectNoSaveNoteContent() {
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith('save_note_content', expect.anything())
    expect(deps.clearUnsaved).not.toHaveBeenCalled()
  }

  async function expectPendingAutosaveDroppedAfterVaultChange(
    hook: ReturnType<typeof renderAutoSaveScopeDraft>,
    nextVaultPath: string,
  ) {
    act(() => {
      hook.result.current.handleContentChange(hook.entry.path, '# Draft\n\nUnsaved')
    })

    hook.rerender({ vaultPath: nextVaultPath })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expectNoSaveNoteContent()
  }

  it('exposes contentChangeRef', () => {
    const { result } = renderSave()
    expect(result.current.contentChangeRef).toBeDefined()
    expect(typeof result.current.contentChangeRef.current).toBe('function')
  })

  it('exposes handleSave', () => {
    const { result } = renderSave()
    expect(typeof result.current.handleSave).toBe('function')
  })

  it('exposes flushBeforeAction', () => {
    const { result } = renderSave()
    expect(typeof result.current.flushBeforeAction).toBe('function')
  })

  it('handleSave calls save with no fallback when no active tab', async () => {
    const { result } = renderSave()

    await act(async () => { await result.current.handleSave() })

    // Should not throw — just a no-op save
  })

  it('handleSave provides fallback for unsaved active tab', async () => {
    const entry = makeEntry('/vault/note.md', 'note', 'note.md')
    const unsavedPaths = new Set(['/vault/note.md'])
    const tabs = [{ entry, content: '# Hello' }]

    const { result } = renderSave({
      tabs,
      activeTabPath: '/vault/note.md',
      unsavedPaths,
    })

    await act(async () => { await result.current.handleSave() })

    // Should complete without error
  })

  it('handles Windows invalid path save failures without clearing unsaved content', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = 'C:\\Users\\@raflymln\\notes\\untitled-note-1777236475.md'
    const entry = makeEntry(path, 'Untitled Note 1777236475', 'untitled-note-1777236475.md')
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('The filename, directory name, or volume label syntax is incorrect. (os error 123)'),
    )

    const { result } = renderSave({
      resolvedPath: 'C:\\Users\\@raflymln\\notes',
      tabs: [{ entry, content: '# Draft\n\nBody' }],
      activeTabPath: path,
      unsavedPaths: new Set([path]),
    })

    let saved = true
    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(false)
    expect(deps.setToastMessage).toHaveBeenCalledWith(
      'Save failed: The note path is invalid on this platform. Rename the note or move it to a valid folder, then try again.',
    )
    expect(deps.clearUnsaved).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('pauses manual saves when a stale editor has no active vault', async () => {
    const { result } = renderMissingVaultDraft()

    let saved = true
    await act(async () => {
      saved = await result.current.handleSave()
    })

    expect(saved).toBe(false)
    expect(deps.setToastMessage).toHaveBeenCalledWith('Select or restore a vault before saving.')
    expectNoSaveNoteContent()
  })

  it('pauses stale auto-save timers when the active vault disappears before debounce fires', async () => {
    await expectPendingAutosaveDroppedAfterVaultChange(
      renderAutoSaveScopeDraft({ initialVaultPath: '/vault', notePath: '/vault/draft.md' }),
      '',
    )
  })

  it('drops pending auto-save content when the active vault changes', async () => {
    await expectPendingAutosaveDroppedAfterVaultChange(
      renderAutoSaveScopeDraft({ initialVaultPath: '/old-vault', notePath: '/old-vault/draft.md' }),
      '/new-vault',
    )
  })

  it('ignores stale editor changes outside the active vault', async () => {
    const { result, entry } = renderAutoSaveScopeDraft({
      initialVaultPath: '/new-vault',
      notePath: '/old-vault/draft.md',
    })

    act(() => {
      result.current.handleContentChange(entry.path, '# Draft\n\nStale edit')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    expectNoSaveNoteContent()
    expect(deps.trackUnsaved).not.toHaveBeenCalled()
  })

  it('does not flush unsaved tab content to disk without an active vault', async () => {
    const { path, result } = renderMissingVaultDraft()

    await act(async () => {
      await result.current.flushBeforeAction(path)
    })

    expect(deps.setToastMessage).toHaveBeenCalledWith('Select or restore a vault before saving.')
    expectNoSaveNoteContent()
  })

  it('handleContentChange is a function', () => {
    const { result } = renderSave()
    expect(typeof result.current.handleContentChange).toBe('function')
  })

  it('marks the edited path as unsaved immediately on content change', () => {
    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')
    const { result } = renderSave({
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
    })

    act(() => {
      result.current.handleContentChange(entry.path, '# Note\n\nAfter')
    })

    expect(deps.trackUnsaved).toHaveBeenCalledWith(entry.path)
  })

  it('bumps modifiedAt in live entry state after saving', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-16T14:45:00Z'))

    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')
    const { result } = renderSave({
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Note\n\nAfter')
      await result.current.handleSave()
    })

    expect(deps.updateEntry).toHaveBeenCalledWith(
      entry.path,
      expect.objectContaining({
        modifiedAt: Math.floor(new Date('2026-04-16T14:45:00Z').getTime() / 1000),
      }),
    )
  })

  it('re-reads the saved note from disk so backend-stamped frontmatter becomes searchable', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const refreshEntries = vi.fn().mockResolvedValue(undefined)
    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')

    const { result } = renderSave({
      refreshEntries,
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Note\n\n```\ncode\n```')
      await result.current.handleSave()
    })

    expect(refreshEntries).toHaveBeenCalledWith(['/vault/note.md'])
  })

  it('re-stamps the note content cache with the saved content and refreshed identity', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(cacheNoteContent).mockClear()
    const freshEntry = { ...makeEntry('/vault/note.md', 'Note', 'note.md'), modifiedAt: 42, fileSize: 99 }
    const refreshEntries = vi.fn().mockResolvedValue([freshEntry])
    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')

    const { result } = renderSave({
      refreshEntries,
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Note\n\nAfter')
      await result.current.handleSave()
    })

    expect(cacheNoteContent).toHaveBeenCalledWith('/vault/note.md', '# Note\n\nAfter', freshEntry)
  })

  it('does not stamp the content cache when a newer save superseded the refresh', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(cacheNoteContent).mockClear()
    const freshEntry = { ...makeEntry('/vault/note.md', 'Note', 'note.md'), modifiedAt: 42, fileSize: 99 }
    const firstRefresh = createDeferred<Array<VaultEntry | null>>()
    const refreshEntries = vi.fn()
      .mockReturnValueOnce(firstRefresh.promise)
      .mockResolvedValue([freshEntry])
    const entry = makeEntry('/vault/note.md', 'Note', 'note.md')

    const { result } = renderSave({
      refreshEntries,
      tabs: [{ entry, content: '# Note\n\nBefore' }],
      activeTabPath: entry.path,
      unsavedPaths: new Set([entry.path]),
    })

    await act(async () => {
      result.current.handleContentChange(entry.path, '# Note\n\nFirst')
      await result.current.handleSave()
      result.current.handleContentChange(entry.path, '# Note\n\nSecond')
      await result.current.handleSave()
      firstRefresh.resolve([freshEntry])
      await firstRefresh.promise
    })

    // useSaveNote also stamps identity-less on every save; only the
    // identity-carrying stamps (with a refreshed entry) matter here.
    const stampedContents = vi.mocked(cacheNoteContent).mock.calls
      .filter(([, , stampedEntry]) => stampedEntry)
      .map(([, content]) => content)
    expect(stampedContents).not.toContain('# Note\n\nFirst')
    expect(stampedContents).toContain('# Note\n\nSecond')
  })

  it('keeps saving to the renamed path for edits made after a manual filename rename', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/vault/fresh-title.md'
    const newPath = '/vault/manual-name.md'
    const entry = makeEntry(oldPath, 'Fresh Title', 'fresh-title.md')

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      return undefined
    })

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/vault')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n\nBody')
    })

    const { result } = renderSave({
      tabs: [{ entry, content: '# Fresh Title\n\nBody' }],
      activeTabPath: oldPath,
      unsavedPaths: new Set([oldPath]),
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    // The rich editor's own tab-swap tracking picks up the rename synchronously
    // (see the 'laputa:note-path-renamed' listener in useEditorTabSwap.ts), so
    // it calls handleContentChange with the new path from here on.
    await act(async () => {
      result.current.handleContentChange(newPath, '# Fresh Title\n\nBody\n\nMore text')
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: oldPath, content: '# Fresh Title\n\nBody\n\nMore text' },
    ])
    expect(deps.replaceEntry).toHaveBeenCalledWith(
      oldPath,
      expect.objectContaining({ path: newPath, filename: 'manual-name.md' }),
      '# Fresh Title\n\nBody',
    )
  })

  it('tolerates a macOS alias of the current path for editor saves after a rename', async () => {
    // Alias tolerance (macOS /tmp vs /private/tmp for the same file) is
    // independent of rename bookkeeping — it must hold for the note's
    // *current* path, not just pre-rename identities.
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/tmp/vault/fresh-title.md'
    const newPath = '/tmp/vault/manual-name.md'
    const aliasNewPath = '/private/tmp/vault/manual-name.md'
    const entry = makeEntry(oldPath, 'Fresh Title', 'fresh-title.md')

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'save_note_content') return undefined
      return undefined
    })

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/tmp/vault')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n\nBody')
    })

    const { result } = renderSave({
      resolvedPath: '/tmp/vault',
      tabs: [{ entry, content: '# Fresh Title\n\nBody' }],
      activeTabPath: oldPath,
      unsavedPaths: new Set([oldPath]),
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    await act(async () => {
      result.current.handleContentChange(newPath, '# Fresh Title\n\nBody\n\nAlias edit')
      await result.current.savePendingForPath(aliasNewPath)
    })

    const saveCalls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_note_content')
    expect(saveCalls.at(-1)).toEqual([
      'save_note_content',
      { path: newPath, content: '# Fresh Title\n\nBody\n\nAlias edit' },
    ])
    expect(saveCalls).not.toContainEqual([
      'save_note_content',
      { path: aliasNewPath, content: '# Fresh Title\n\nBody\n\nAlias edit' },
    ])
  })

  it('passes the active tab workspace path to manual filename renames', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    const oldPath = '/team/fresh-title.md'
    const newPath = '/team/manual-name.md'
    const entry = {
      ...makeEntry(oldPath, 'Fresh Title', 'fresh-title.md'),
      workspace: makeWorkspace('/team', 'team'),
    }

    deps.handleRenameFilename.mockImplementation(async (path, newFilenameStem, vaultPath, onEntryRenamed) => {
      expect(path).toBe(oldPath)
      expect(newFilenameStem).toBe('manual-name')
      expect(vaultPath).toBe('/team')
      onEntryRenamed(path, { path: newPath, filename: 'manual-name.md', title: 'Fresh Title' }, '# Fresh Title\n')
    })

    const { result } = renderSave({
      resolvedPath: '/personal',
      tabs: [{ entry, content: '# Fresh Title\n' }],
      activeTabPath: oldPath,
    })

    await act(async () => {
      await result.current.handleFilenameRename(oldPath, 'manual-name')
    })

    expect(deps.handleRenameFilename).toHaveBeenCalledWith(
      oldPath,
      'manual-name',
      '/team',
      expect.any(Function),
    )
  })
})
