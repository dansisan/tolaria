import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  buildFilenameRenamedEntry,
  renameToastMessage,
  useNoteRename,
} from './useNoteRename'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/test.md', filename: 'test.md', title: 'Test Note', isA: 'Note',
  aliases: [], belongsTo: [], relatedTo: [], status: 'Active', archived: false,
  modifiedAt: 1700000000, createdAt: 1700000000, fileSize: 100, snippet: '',
  wordCount: 0, relationships: {}, icon: null, color: null, order: null,
  outgoingLinks: [], template: null, sort: null, sidebarLabel: null,
  view: null, visible: null, properties: {},
  ...overrides,
})

const makeWorkspace = (path: string, alias = 'workspace'): NonNullable<VaultEntry['workspace']> => ({
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
})

describe('buildFilenameRenamedEntry', () => {
  it('syncs a filename-derived title to the new filename', () => {
    const entry = makeEntry({ path: '/vault/old-stem.md', filename: 'old-stem.md', title: 'old-stem' })
    const renamed = buildFilenameRenamedEntry(entry, '/vault/new-stem.md')
    expect(renamed.filename).toBe('new-stem.md')
    expect(renamed.title).toBe('new-stem')
  })

  it('keeps an explicit title (H1/frontmatter) that differs from the filename', () => {
    const entry = makeEntry({ path: '/vault/old-stem.md', filename: 'old-stem.md', title: 'My Real Title' })
    const renamed = buildFilenameRenamedEntry(entry, '/vault/new-stem.md')
    expect(renamed.filename).toBe('new-stem.md')
    expect(renamed.title).toBe('My Real Title')
  })
})

describe('renameToastMessage', () => {
  it('returns "Renamed" when no files updated', () => {
    expect(renameToastMessage(0, 0)).toBe('Renamed')
  })

  it('returns singular when 1 file updated', () => {
    expect(renameToastMessage(1, 0)).toBe('Updated 1 note')
  })

  it('returns plural when multiple files updated', () => {
    expect(renameToastMessage(3, 0)).toBe('Updated 3 notes')
  })

  it('surfaces failed linked-note rewrites even when some updates succeeded', () => {
    expect(renameToastMessage(2, 1)).toBe('Updated 2 notes, but 1 linked note needs manual updates')
  })

  it('surfaces failed linked-note rewrites when none of them updated cleanly', () => {
    expect(renameToastMessage(0, 2)).toBe('Renamed, but 2 linked notes need manual updates')
  })
})

describe('useNoteRename hook', () => {
  const setToastMessage = vi.fn()
  const setTabs = vi.fn((fn: (prev: unknown[]) => unknown[]) => fn([]))
  const handleSwitchTab = vi.fn()
  const updateTabContent = vi.fn()
  const activeTabPathRef = { current: null as string | null }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    activeTabPathRef.current = null
  })

  const renderUseNoteRename = (entries: VaultEntry[] = []) =>
    renderHook(() => useNoteRename(
      { entries, setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

  it('uses the note workspace root for filename rename even when the app-level vault path differs', async () => {
    const entry = makeEntry({
      path: '/team/old-name.md',
      filename: 'old-name.md',
      title: 'Project Kickoff',
      workspace: makeWorkspace('/team', 'team'),
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/team/manual-name.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# New\n'
      return ''
    })
    const { result } = renderUseNoteRename([entry])

    await act(async () => {
      await result.current.handleRenameFilename('/team/old-name.md', 'manual-name', '/personal', vi.fn())
    })

    expect(mockInvoke).toHaveBeenCalledWith('rename_note_filename', expect.objectContaining({
      vault_path: '/team',
      old_path: '/team/old-name.md',
      new_filename_stem: 'manual-name',
    }))
  })

  it('switches active tab when renamed note is active', async () => {
    const entry = makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md' })
    activeTabPathRef.current = '/vault/old-name.md'
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/new.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# New\n'
      return ''
    })

    const { result } = renderUseNoteRename([entry])
    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'new', '/vault', vi.fn())
    })

    expect(handleSwitchTab).toHaveBeenCalledWith('/vault/new.md')
  })

  it('switches active tab when macOS /tmp aliases identify the renamed note', async () => {
    const entry = makeEntry({ path: '/private/tmp/vault/old-name.md', filename: 'old-name.md' })
    activeTabPathRef.current = '/private/tmp/vault/old-name.md'
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/tmp/vault/new.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# New\n'
      return ''
    })

    const { result } = renderUseNoteRename([entry])
    await act(async () => {
      await result.current.handleRenameFilename('/tmp/vault/old-name.md', 'new', '/vault', vi.fn())
    })

    expect(handleSwitchTab).toHaveBeenCalledWith('/tmp/vault/new.md')
  })

  it('handleRenameFilename renames the file while preserving the existing title', async () => {
    const entry = makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md', title: 'Project Kickoff' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/manual-name.md', updated_files: 1, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'manual-name', '/vault', onEntryRenamed)
    })

    expect(mockInvoke).toHaveBeenCalledWith('rename_note_filename', expect.objectContaining({
      old_path: '/vault/old-name.md',
      new_filename_stem: 'manual-name',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/old-name.md',
      expect.objectContaining({
        path: '/vault/manual-name.md',
        filename: 'manual-name.md',
        title: 'Project Kickoff',
      }),
      '# Project Kickoff\n',
    )
    expect(setToastMessage).toHaveBeenCalledWith('Updated 1 note')
  })

  it('preserves active tab metadata when filename rename lands after a stale vault reload', async () => {
    const entry = makeEntry({ path: '/vault/untitled-1.md', filename: 'untitled-1.md', title: 'Fresh Title' })
    let tabs = [{ entry, content: '# Fresh Title\n' }]
    const setTabs = vi.fn((update: typeof tabs | ((prev: typeof tabs) => typeof tabs)) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/fresh-title.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# Fresh Title\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [], setToastMessage },
      { tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleRenameFilename('/vault/untitled-1.md', 'fresh-title', '/vault', onEntryRenamed)
    })

    expect(tabs[0].entry).toEqual(expect.objectContaining({
      path: '/vault/fresh-title.md',
      filename: 'fresh-title.md',
      title: 'Fresh Title',
      isA: 'Note',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/untitled-1.md',
      expect.objectContaining({ title: 'Fresh Title', filename: 'fresh-title.md' }),
      '# Fresh Title\n',
    )
  })

  it('syncs a filename-derived frontmatter title in the open tab so the breadcrumb does not show a stale title', async () => {
    // Reproduces the "create new note for date" flow: the frontmatter title
    // mirrors the original filename stem exactly (no slugify difference).
    const entry = makeEntry({ path: '/vault/2026-07-13.md', filename: '2026-07-13.md', title: '2026-07-13' })
    const openTabContent = '---\ntitle: 2026-07-13\ntype: Note\n---\n\nBody.\n'
    let tabs = [{ entry, content: openTabContent }]
    const setTabs = vi.fn((update: typeof tabs | ((prev: typeof tabs) => typeof tabs)) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') {
        return { new_path: '/vault/Team Standup Notes.md', updated_files: 0, failed_updates: 0 }
      }
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [], setToastMessage },
      { tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameFilename('/vault/2026-07-13.md', 'Team Standup Notes', '/vault', vi.fn())
    })

    expect(tabs[0].content).toBe('---\ntitle: Team Standup Notes\ntype: Note\n---\n\nBody.\n')
  })

  it('does not clobber an unsaved background tab when refreshing other open tabs after a filename rename', async () => {
    const renamedEntry = makeEntry({ path: '/vault/untitled-1.md', filename: 'untitled-1.md', title: 'Fresh Title' })
    const otherPath = '/vault/note-b.md'
    const unsavedContent = '# Note B\n\nUnsaved local edits the user just typed'
    const staleDiskContent = '# Note B\n\nStale content still on disk'
    const otherEntry = makeEntry({ path: otherPath, filename: 'note-b.md', title: 'Note B' })

    let tabs = [
      { entry: renamedEntry, content: '# Fresh Title\n' },
      { entry: otherEntry, content: unsavedContent },
    ]
    const setTabs = vi.fn((update: typeof tabs | ((prev: typeof tabs) => typeof tabs)) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    })
    const realUpdateTabContent = (path: string, newContent: string) => {
      tabs = tabs.map((tab) => tab.entry.path === path ? { ...tab, content: newContent } : tab)
    }

    vi.mocked(mockInvoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/fresh-title.md', updated_files: 1, failed_updates: 0 }
      if (cmd === 'get_note_content' && (args as { path?: string } | undefined)?.path === otherPath) return staleDiskContent
      if (cmd === 'get_note_content') return '# Fresh Title\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [], setToastMessage },
      { tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent: realUpdateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameFilename('/vault/untitled-1.md', 'fresh-title', '/vault', vi.fn())
    })

    const tabB = tabs.find((tab) => tab.entry.path === otherPath)
    expect(tabB?.content).toBe(unsavedContent)
  })

  it('warns when rename succeeds but some backlink rewrites fail', async () => {
    const entry = makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md', title: 'Old' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/new.md', updated_files: 1, failed_updates: 2 }
      if (cmd === 'get_note_content') return '# New\n'
      return ''
    })

    const { result } = renderUseNoteRename([entry])
    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'new', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith(
      'Updated 1 note, but 2 linked notes need manual updates',
    )
  })

  it('handleRenameFilename surfaces backend conflict errors', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('A note with that name already exists'))

    const { result } = renderHook(() => useNoteRename(
      { entries: [makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md' })], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'manual-name', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('A note with that name already exists')
  })

  it('does not register a path mapping when a filename rename attempt fails with a collision', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('A note with that name already exists'))
    const onEntryRenamed = vi.fn()

    const { result } = renderHook(() => useNoteRename(
      { entries: [makeEntry({ path: '/vault/a.md', filename: 'a.md' })], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameFilename('/vault/a.md', 'a2', '/vault', onEntryRenamed)
    })

    expect(onEntryRenamed).not.toHaveBeenCalled()
    expect(setTabs).not.toHaveBeenCalled()
    expect(handleSwitchTab).not.toHaveBeenCalled()
  })

  it('handleMoveNoteToFolder moves the note and keeps its title intact', async () => {
    const entry = makeEntry({ path: '/vault/notes/project-kickoff.md', filename: 'project-kickoff.md', title: 'Project Kickoff' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'move_note_to_folder') {
        return {
          new_path: '/vault/projects/project-kickoff.md',
          updated_files: 1,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleMoveNoteToFolder('/vault/notes/project-kickoff.md', 'projects', '/vault', onEntryRenamed)
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_folder', expect.objectContaining({
      old_path: '/vault/notes/project-kickoff.md',
      folder_path: 'projects',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/notes/project-kickoff.md',
      expect.objectContaining({
        path: '/vault/projects/project-kickoff.md',
        filename: 'project-kickoff.md',
        title: 'Project Kickoff',
      }),
      '# Project Kickoff\n',
    )
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "projects" and updated 1 note')
  })

  it('normalizes folder move targets before sending them to the backend', async () => {
    const entry = makeEntry({ path: '/vault/notes/project-kickoff.md', filename: 'project-kickoff.md', title: 'Project Kickoff' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'move_note_to_folder') {
        return {
          new_path: '/vault/projects/active/project-kickoff.md',
          updated_files: 0,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleMoveNoteToFolder('/vault/notes/project-kickoff.md', String.raw`/projects\active/`, '/vault', vi.fn())
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_folder', expect.objectContaining({
      folder_path: 'projects/active',
    }))
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "active"')
  })

  it('handleMoveNoteToWorkspace moves the note to a different workspace', async () => {
    const sourceWorkspace = makeWorkspace('/personal', 'personal')
    const destinationWorkspace = makeWorkspace('/team', 'team')
    destinationWorkspace.label = 'Team'
    const entry = makeEntry({
      path: '/personal/notes/project-kickoff.md',
      filename: 'project-kickoff.md',
      title: 'Project Kickoff',
      workspace: sourceWorkspace,
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'move_note_to_workspace') {
        return {
          new_path: '/team/notes/project-kickoff.md',
          updated_files: 1,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleMoveNoteToWorkspace(
        '/personal/notes/project-kickoff.md',
        destinationWorkspace,
        '/personal',
        onEntryRenamed,
      )
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_workspace', expect.objectContaining({
      source_vault_path: '/personal',
      destination_vault_path: '/team',
      old_path: '/personal/notes/project-kickoff.md',
      replacement_target: 'team/notes/project-kickoff',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/personal/notes/project-kickoff.md',
      expect.objectContaining({
        path: '/team/notes/project-kickoff.md',
        filename: 'project-kickoff.md',
        workspace: destinationWorkspace,
      }),
      '# Project Kickoff\n',
    )
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "Team" and updated 1 note')
  })
})
