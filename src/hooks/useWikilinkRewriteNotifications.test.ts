import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WIKILINK_REWRITE_COMPLETED_EVENT, useWikilinkRewriteNotifications } from './useWikilinkRewriteNotifications'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  listener: undefined as ((event: { payload: Record<string, unknown> }) => void) | undefined,
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

vi.mock('../mock-tauri', () => ({
  isTauri: mocks.isTauri,
}))

function emitRewriteCompleted(payload: Record<string, unknown>) {
  act(() => {
    mocks.listener?.({ payload })
  })
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function makeEntry(path: string) {
  return { path, filename: path.split('/').pop() ?? path, title: path }
}

describe('useWikilinkRewriteNotifications', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.isTauri.mockReset()
    mocks.listen.mockReset()
    mocks.unlisten.mockReset()
    mocks.listener = undefined
    mocks.isTauri.mockReturnValue(true)
    mocks.listen.mockImplementation((_event: string, listener: typeof mocks.listener) => {
      mocks.listener = listener
      return Promise.resolve(mocks.unlisten)
    })
  })

  it('does not subscribe outside Tauri', () => {
    mocks.isTauri.mockReturnValue(false)

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage: vi.fn(),
    }))

    expect(mocks.listen).not.toHaveBeenCalled()
  })

  it('subscribes to the wikilink rewrite completion event', async () => {
    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage: vi.fn(),
    }))

    await settle()
    expect(mocks.listen).toHaveBeenCalledWith(WIKILINK_REWRITE_COMPLETED_EVENT, expect.any(Function))
  })

  it('ignores a completion with nothing updated and nothing failed', async () => {
    const setToastMessage = vi.fn()
    const updateTabContent = vi.fn()

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [{ entry: makeEntry('/vault/other.md'), content: 'stale' }],
      updateTabContent,
      setToastMessage,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 0,
      failed_updates: 0,
      updated_paths: [],
    })
    await settle()

    expect(updateTabContent).not.toHaveBeenCalled()
    expect(setToastMessage).not.toHaveBeenCalled()
  })

  it('reloads open tabs whose wikilinks were rewritten and shows a toast', async () => {
    const setToastMessage = vi.fn()
    const updateTabContent = vi.fn()
    mocks.invoke.mockResolvedValue('# Refreshed content\n')

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [
        { entry: makeEntry('/vault/other.md'), content: 'stale' },
        { entry: makeEntry('/vault/unrelated.md'), content: 'untouched' },
      ],
      updateTabContent,
      setToastMessage,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 1,
      failed_updates: 0,
      updated_paths: ['/vault/other.md'],
    })
    await settle()

    expect(updateTabContent).toHaveBeenCalledWith('/vault/other.md', '# Refreshed content\n')
    expect(updateTabContent).not.toHaveBeenCalledWith('/vault/unrelated.md', expect.anything())
    expect(setToastMessage).toHaveBeenCalledWith('Updated 1 note')
  })

  it('does not clobber an open tab that has unsaved edits', async () => {
    const setToastMessage = vi.fn()
    const updateTabContent = vi.fn()
    mocks.invoke.mockResolvedValue('# Stale disk content\n')

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [{ entry: makeEntry('/vault/other.md'), content: 'unsaved edits' }],
      updateTabContent,
      isPathUnsaved: (path) => path === '/vault/other.md',
      setToastMessage,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 1,
      failed_updates: 0,
      updated_paths: ['/vault/other.md'],
    })
    await settle()

    expect(updateTabContent).not.toHaveBeenCalled()
  })

  it('refreshes just the rewritten notes via refreshEntries instead of a full vault reload', async () => {
    const refreshEntries = vi.fn()
    const reloadVault = vi.fn()

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage: vi.fn(),
      refreshEntries,
      reloadVault,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 1,
      failed_updates: 0,
      updated_paths: ['/vault/other.md'],
    })
    await settle()

    expect(refreshEntries).toHaveBeenCalledWith(['/vault/other.md'])
    expect(reloadVault).not.toHaveBeenCalled()
  })

  it('falls back to a full vault reload when refreshEntries is not wired', async () => {
    const reloadVault = vi.fn()

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage: vi.fn(),
      reloadVault,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 1,
      failed_updates: 0,
      updated_paths: ['/vault/other.md'],
    })
    await settle()

    expect(reloadVault).toHaveBeenCalledOnce()
  })

  it('surfaces a warning toast when some backlink rewrites fail', async () => {
    const setToastMessage = vi.fn()

    renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage,
    }))
    await settle()

    emitRewriteCompleted({
      old_path: '/vault/old.md',
      new_path: '/vault/new.md',
      updated_files: 1,
      failed_updates: 2,
      updated_paths: ['/vault/other.md'],
    })
    await settle()

    expect(setToastMessage).toHaveBeenCalledWith('Updated 1 note, but 2 linked notes need manual updates')
  })

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useWikilinkRewriteNotifications({
      tabs: [],
      updateTabContent: vi.fn(),
      setToastMessage: vi.fn(),
    }))
    await settle()

    unmount()
    await settle()

    expect(mocks.unlisten).toHaveBeenCalledOnce()
  })
})
