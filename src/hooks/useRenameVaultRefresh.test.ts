import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import type { NoteActionsConfig } from './useNoteActions'
import { useNoteActions } from './useNoteActions'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))
vi.mock('./mockFrontmatterHelpers', () => ({
  updateMockFrontmatter: vi.fn().mockReturnValue('---\ntitle: New Title\n---\n# New Title\n'),
  deleteMockFrontmatterProperty: vi.fn().mockReturnValue('---\n---\n'),
}))

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/old-title.md',
    filename: 'old-title.md',
    title: 'Old Title',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1700000000,
    createdAt: 1700000000,
    fileSize: 100,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    outgoingLinks: [],
    template: null,
    sort: null,
    sidebarLabel: null,
    view: null,
    visible: null,
    properties: {},
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    hasH1: false,
    ...overrides,
  }
}

function makeNoteActionsConfig(reloadVault: () => Promise<unknown>): NoteActionsConfig & { reloadVault: typeof reloadVault } {
  return {
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    entries: [makeEntry()],
    setToastMessage: vi.fn(),
    updateEntry: vi.fn(),
    vaultPath: '/vault',
    reloadVault,
  }
}

// The backend defers the vault-wide wikilink rewrite to a background job and
// reports its result later via the `wikilinks-rewrite-completed` event
// (handled by useWikilinkRewriteNotifications, tested separately). A rename
// call must resolve without synchronously reloading the vault or other
// entries — re-scanning on every rename is exactly what made renames feel
// slow before this was decoupled.
describe('rename vault refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })

  it('does not reload the vault synchronously after title frontmatter rename completes', async () => {
    const reloadVault = vi.fn().mockResolvedValue([])
    const config = makeNoteActionsConfig(reloadVault)
    const { result } = renderHook(() => useNoteActions(config))

    await act(async () => {
      await result.current.handleSelectNote(makeEntry())
    })

    await act(async () => {
      await result.current.handleUpdateFrontmatter('/vault/old-title.md', 'title', 'New Title')
    })

    expect(reloadVault).not.toHaveBeenCalled()
  })
})
