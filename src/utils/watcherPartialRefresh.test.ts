import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import {
  applyWatcherPartialRefresh,
  WATCHER_PARTIAL_REFRESH_MAX_PATHS,
} from './watcherPartialRefresh'

function entry(path: string): VaultEntry {
  return { path, filename: path.split('/').pop() ?? path } as VaultEntry
}

function makeDeps(overrides: Partial<Parameters<typeof applyWatcherPartialRefresh>[1]> = {}) {
  const known = new Map<string, VaultEntry>([
    ['/vault/a.md', entry('/vault/a.md')],
    ['/vault/b.md', entry('/vault/b.md')],
    ['/vault/.laputa/views/work.yml', entry('/vault/.laputa/views/work.yml')],
  ])
  return {
    findEntry: (path: string) => known.get(path),
    reloadEntry: vi.fn(async (path: string) => entry(path)),
    scanEntry: vi.fn(async (path: string) => entry(path)),
    addEntry: vi.fn(),
    updateEntry: vi.fn(),
    reloadViews: vi.fn(),
    refreshGitModifiedFiles: vi.fn(),
    isActiveTabPath: () => false,
    hasUnsavedChanges: () => false,
    isEditorFocused: () => false,
    replaceActiveTab: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('applyWatcherPartialRefresh', () => {
  it('refreshes each known entry in place and reports handled', async () => {
    const deps = makeDeps()

    const result = await applyWatcherPartialRefresh(['/vault/a.md', '/vault/b.md'], deps)

    expect(result).toBe('handled')
    expect(deps.reloadEntry).toHaveBeenCalledTimes(2)
    expect(deps.updateEntry).toHaveBeenCalledWith('/vault/a.md', expect.objectContaining({ path: '/vault/a.md' }))
    expect(deps.updateEntry).toHaveBeenCalledWith('/vault/b.md', expect.objectContaining({ path: '/vault/b.md' }))
    expect(deps.refreshGitModifiedFiles).toHaveBeenCalled()
    expect(deps.reloadViews).not.toHaveBeenCalled()
  })

  it('adds an externally created note without a full reload', async () => {
    const deps = makeDeps()

    const result = await applyWatcherPartialRefresh(['/vault/new-file.md'], deps)

    expect(result).toBe('handled')
    expect(deps.scanEntry).toHaveBeenCalledWith('/vault/new-file.md')
    expect(deps.addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: '/vault/new-file.md' }))
    expect(deps.reloadEntry).not.toHaveBeenCalled()
    expect(deps.updateEntry).not.toHaveBeenCalled()
    expect(deps.refreshGitModifiedFiles).toHaveBeenCalled()
  })

  it('refreshes known entries and adds new ones in the same batch', async () => {
    const deps = makeDeps()

    const result = await applyWatcherPartialRefresh(['/vault/a.md', '/vault/new-file.md'], deps)

    expect(result).toBe('handled')
    expect(deps.updateEntry).toHaveBeenCalledWith('/vault/a.md', expect.objectContaining({ path: '/vault/a.md' }))
    expect(deps.addEntry).toHaveBeenCalledWith(expect.objectContaining({ path: '/vault/new-file.md' }))
  })

  it('requires a full reload when a new path is not a file the vault scan would list', async () => {
    // Directories, dotfiles and gitignored paths resolve to null: adding them
    // would invent an entry a full scan never produces.
    const deps = makeDeps({ scanEntry: vi.fn(async () => null) })

    const result = await applyWatcherPartialRefresh(['/vault/New Folder'], deps)

    expect(result).toBe('full-reload-required')
    expect(deps.addEntry).not.toHaveBeenCalled()
  })

  it('falls back to a full reload when scanning a new path fails', async () => {
    const deps = makeDeps({
      scanEntry: vi.fn(async () => {
        throw new Error('unreadable')
      }),
    })

    expect(await applyWatcherPartialRefresh(['/vault/new-file.md'], deps)).toBe('full-reload-required')
    expect(deps.addEntry).not.toHaveBeenCalled()
  })

  it('requires a full reload when there are no paths', async () => {
    const deps = makeDeps()

    expect(await applyWatcherPartialRefresh([], deps)).toBe('full-reload-required')
  })

  it('requires a full reload above the path budget', async () => {
    const deps = makeDeps({ findEntry: (path: string) => entry(path) })
    const paths = Array.from({ length: WATCHER_PARTIAL_REFRESH_MAX_PATHS + 1 }, (_, i) => `/vault/n${i}.md`)

    expect(await applyWatcherPartialRefresh(paths, deps)).toBe('full-reload-required')
    expect(deps.reloadEntry).not.toHaveBeenCalled()
  })

  it('falls back to a full reload when reloading an entry fails (e.g. deleted file)', async () => {
    const deps = makeDeps({
      reloadEntry: vi.fn(async () => {
        throw new Error('missing')
      }),
    })

    expect(await applyWatcherPartialRefresh(['/vault/a.md'], deps)).toBe('full-reload-required')
  })

  it('reloads saved views when a view definition file changed', async () => {
    const deps = makeDeps()

    await applyWatcherPartialRefresh(['/vault/.laputa/views/work.yml'], deps)

    expect(deps.reloadViews).toHaveBeenCalled()
  })

  it('reloads saved views when a view definition file was added', async () => {
    const deps = makeDeps()

    await applyWatcherPartialRefresh(['/vault/.laputa/views/added.yml'], deps)

    expect(deps.addEntry).toHaveBeenCalled()
    expect(deps.reloadViews).toHaveBeenCalled()
  })

  it('replaces the active tab when its note changed externally and is clean', async () => {
    const deps = makeDeps({
      isActiveTabPath: (path: string) => path === '/vault/a.md',
    })

    await applyWatcherPartialRefresh(['/vault/a.md'], deps)

    expect(deps.replaceActiveTab).toHaveBeenCalledWith(expect.objectContaining({ path: '/vault/a.md' }))
  })

  it('leaves the active tab alone while it has unsaved changes', async () => {
    const deps = makeDeps({
      isActiveTabPath: (path: string) => path === '/vault/a.md',
      hasUnsavedChanges: () => true,
    })

    await applyWatcherPartialRefresh(['/vault/a.md'], deps)

    expect(deps.replaceActiveTab).not.toHaveBeenCalled()
  })

  it('leaves the active tab alone while the user is typing in the editor', async () => {
    const deps = makeDeps({
      isActiveTabPath: (path: string) => path === '/vault/a.md',
      isEditorFocused: () => true,
    })

    await applyWatcherPartialRefresh(['/vault/a.md'], deps)

    expect(deps.replaceActiveTab).not.toHaveBeenCalled()
  })
})
