import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDeleteActions } from './useDeleteActions'
import type { VaultEntry } from '../types'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const { mockInvoke, isTauri } = await import('../mock-tauri')
const { invoke } = await import('@tauri-apps/api/core')
const mockInvokeFn = mockInvoke as ReturnType<typeof vi.fn>
const isTauriFn = isTauri as ReturnType<typeof vi.fn>
const invokeFn = invoke as ReturnType<typeof vi.fn>

describe('useDeleteActions', () => {
  let onDeselectNote: ReturnType<typeof vi.fn>
  let removeEntry: ReturnType<typeof vi.fn>
  let removeEntries: ReturnType<typeof vi.fn>
  let resolveVaultPathForPath: ReturnType<typeof vi.fn>
  let refreshModifiedFiles: ReturnType<typeof vi.fn>
  let reloadVault: ReturnType<typeof vi.fn>
  let setToastMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onDeselectNote = vi.fn()
    removeEntry = vi.fn()
    removeEntries = vi.fn()
    resolveVaultPathForPath = vi.fn()
    refreshModifiedFiles = vi.fn().mockResolvedValue(undefined)
    reloadVault = vi.fn().mockResolvedValue(undefined)
    setToastMessage = vi.fn()
    mockInvokeFn.mockReset()
    invokeFn.mockReset()
    invokeFn.mockResolvedValue(undefined)
    isTauriFn.mockReturnValue(false)
  })

  function renderDeleteActions(options: {
    resolveVaultPathForPath?: (path: string) => string | null | undefined
    onInternalVaultWrite?: (path: string) => void
  } = {}) {
    return renderHook(() =>
      useDeleteActions({
        onDeselectNote,
        onInternalVaultWrite: options.onInternalVaultWrite,
        removeEntry,
        removeEntries,
        resolveVaultPathForPath: options.resolveVaultPathForPath,
        refreshModifiedFiles,
        reloadVault,
        setToastMessage,
      }),
    )
  }

  async function openDeleteDialog(
    result: ReturnType<typeof renderDeleteActions>['result'],
    paths: string[],
  ) {
    if (paths.length === 1) {
      await act(async () => {
        await result.current.handleDeleteNote(paths[0])
      })
      return
    }

    act(() => {
      result.current.handleBulkDeletePermanently(paths)
    })
  }

  async function confirmCurrentDelete(result: ReturnType<typeof renderDeleteActions>['result']) {
    await act(async () => {
      await result.current.confirmDelete!.onConfirm()
    })
  }

  async function confirmDeleteAndExpectBatchCall(paths: string[], deletedPaths = paths) {
    mockInvokeFn.mockResolvedValue(deletedPaths)
    const { result } = renderDeleteActions()

    await openDeleteDialog(result, paths)
    await confirmCurrentDelete(result)

    expect(result.current.confirmDelete).toBeNull()
    expect(mockInvokeFn).toHaveBeenCalledTimes(1)
    expect(mockInvokeFn).toHaveBeenCalledWith('batch_delete_notes', { paths })

    return { result }
  }

  // --- deleteNoteFromDisk ---

  describe('deleteNoteFromDisk', () => {
    it('invokes batch_delete_notes, updates pending state, and returns true', async () => {
      let resolveDelete: ((paths: string[]) => void) | null = null
      mockInvokeFn.mockImplementation(() => new Promise((resolve) => {
        resolveDelete = resolve as (paths: string[]) => void
      }))
      const { result } = renderDeleteActions()
      let okPromise: Promise<boolean> | undefined

      act(() => {
        okPromise = result.current.deleteNoteFromDisk('/vault/a.md')
      })

      expect(result.current.pendingDeleteCount).toBe(1)
      expect(mockInvokeFn).toHaveBeenCalledWith('batch_delete_notes', { paths: ['/vault/a.md'] })
      expect(onDeselectNote).toHaveBeenCalledWith('/vault/a.md')
      expect(removeEntries).toHaveBeenCalledWith(['/vault/a.md'])
      expect(removeEntry).not.toHaveBeenCalled()
      expect(setToastMessage).toHaveBeenNthCalledWith(1, 'Deleting note...')

      let ok: boolean | undefined
      await act(async () => {
        resolveDelete?.(['/vault/a.md'])
        ok = await okPromise
      })

      expect(ok).toBe(true)
      expect(result.current.pendingDeleteCount).toBe(0)
      expect(refreshModifiedFiles).toHaveBeenCalledTimes(1)
      expect(setToastMessage).toHaveBeenLastCalledWith('Note permanently deleted')
    })

    it('passes the owning vault path when deleting a note outside the default vault', async () => {
      mockInvokeFn.mockResolvedValue(['/team/a.md'])
      resolveVaultPathForPath.mockReturnValue('/team')
      const { result } = renderDeleteActions({ resolveVaultPathForPath })

      await act(async () => {
        await result.current.deleteNoteFromDisk('/team/a.md')
      })

      expect(mockInvokeFn).toHaveBeenCalledWith('batch_delete_notes', {
        paths: ['/team/a.md'],
        vaultPath: '/team',
      })
    })

    it('reloads the vault and returns false on failure', async () => {
      mockInvokeFn.mockRejectedValue(new Error('disk full'))
      const { result } = renderDeleteActions()
      let ok: boolean | undefined
      await act(async () => {
        ok = await result.current.deleteNoteFromDisk('/vault/a.md')
      })
      expect(ok).toBe(false)
      expect(reloadVault).toHaveBeenCalledTimes(1)
      expect(refreshModifiedFiles).toHaveBeenCalledTimes(1)
      expect(setToastMessage).toHaveBeenCalledWith(expect.stringContaining('Failed to delete'))
    })
  })

  // --- handleDeleteNote ---

  describe('handleDeleteNote', () => {
    it('sets confirmDelete dialog state', async () => {
      const { result } = renderDeleteActions()
      await openDeleteDialog(result, ['/vault/a.md'])
      expect(result.current.confirmDelete).not.toBeNull()
      expect(result.current.confirmDelete?.title).toBe('Delete permanently?')
    })

    it('onConfirm deletes the note and clears dialog', async () => {
      await confirmDeleteAndExpectBatchCall(['/vault/a.md'])
      expect(setToastMessage).toHaveBeenCalledWith('Note permanently deleted')
    })
  })

  // --- handleBulkDeletePermanently ---

  describe('handleBulkDeletePermanently', () => {
    it.each([
      { paths: ['/vault/a.md'], expectedTitle: 'Delete 1 note permanently?' },
      { paths: ['/vault/a.md', '/vault/b.md'], expectedTitle: 'Delete 2 notes permanently?' },
    ])('sets confirmDelete title for $expectedTitle', ({ paths, expectedTitle }) => {
      const { result } = renderDeleteActions()
      act(() => {
        result.current.handleBulkDeletePermanently(paths)
      })
      expect(result.current.confirmDelete?.title).toBe(expectedTitle)
    })

    it('onConfirm deletes all paths in one backend call and shows toast', async () => {
      await confirmDeleteAndExpectBatchCall(['/vault/a.md', '/vault/b.md'])
      expect(removeEntries).toHaveBeenCalledWith(['/vault/a.md', '/vault/b.md'])
      expect(setToastMessage).toHaveBeenCalledWith('2 notes permanently deleted')
    })

    it('splits bulk deletes by owning vault path', async () => {
      mockInvokeFn.mockImplementation(async (_command, args: { paths: string[] }) => args.paths)
      resolveVaultPathForPath.mockImplementation((path: string) => path.startsWith('/team') ? '/team' : '/personal')
      const { result } = renderDeleteActions({ resolveVaultPathForPath })

      act(() => {
        result.current.handleBulkDeletePermanently(['/personal/a.md', '/team/b.md'])
      })
      await confirmCurrentDelete(result)

      expect(mockInvokeFn).toHaveBeenCalledWith('batch_delete_notes', {
        paths: ['/personal/a.md'],
        vaultPath: '/personal',
      })
      expect(mockInvokeFn).toHaveBeenCalledWith('batch_delete_notes', {
        paths: ['/team/b.md'],
        vaultPath: '/team',
      })
      expect(setToastMessage).toHaveBeenCalledWith('2 notes permanently deleted')
    })

    it('reloads the note list when a batch delete only partially succeeds', async () => {
      await confirmDeleteAndExpectBatchCall(['/vault/a.md', '/vault/b.md'], ['/vault/a.md'])

      expect(reloadVault).toHaveBeenCalledTimes(1)
      expect(refreshModifiedFiles).toHaveBeenCalledTimes(1)
      expect(setToastMessage).toHaveBeenLastCalledWith(
        'Deleted 1 of 2 notes. The note list was reloaded to recover failed items.',
      )
    })
  })

  // --- orphaned attachment cleanup ---

  describe('orphaned attachment cleanup', () => {
    const entries = [
      { path: '/vault/a.md', title: 'A', attachmentLinks: ['attachments/gone.png', 'attachments/shared.png'] },
      { path: '/vault/b.md', title: 'B', attachmentLinks: ['attachments/shared.png'] },
    ] as VaultEntry[]

    function renderWithEntries() {
      return renderHook(() =>
        useDeleteActions({
          onDeselectNote,
          removeEntry,
          removeEntries,
          refreshModifiedFiles,
          reloadVault,
          setToastMessage,
          entries,
          vaultPath: '/vault',
        }),
      )
    }

    function mockTauriDelete() {
      isTauriFn.mockReturnValue(true)
      invokeFn.mockImplementation(async (command: string, args: { paths?: string[] }) =>
        command === 'batch_delete_notes_async' ? args.paths : undefined,
      )
    }

    it('deletes an image referenced only by the deleted note', async () => {
      mockTauriDelete()
      const { result } = renderWithEntries()

      await act(async () => {
        await result.current.deleteNoteFromDisk('/vault/a.md')
      })

      expect(invokeFn).toHaveBeenCalledWith('delete_attachment', {
        vaultPath: '/vault',
        attachmentPath: 'attachments/gone.png',
      })
    })

    it('keeps an image still referenced by a surviving note', async () => {
      mockTauriDelete()
      const { result } = renderWithEntries()

      // b.md only references shared.png, which a.md (surviving) still uses.
      await act(async () => {
        await result.current.deleteNoteFromDisk('/vault/b.md')
      })

      expect(invokeFn).not.toHaveBeenCalledWith('delete_attachment', expect.anything())
    })

    it('does not prune attachments when the delete fails', async () => {
      isTauriFn.mockReturnValue(true)
      invokeFn.mockResolvedValue([])
      const { result } = renderWithEntries()

      await act(async () => {
        await result.current.deleteNoteFromDisk('/vault/a.md')
      })

      expect(invokeFn).not.toHaveBeenCalledWith('delete_attachment', expect.anything())
    })
  })

  // --- internal write suppression ---

  describe('internal write suppression', () => {
    it('marks deleted note paths as internal writes so the vault watcher does not redundantly rescan after a delete', async () => {
      mockInvokeFn.mockResolvedValue(['/vault/a.md', '/vault/b.md'])
      const onInternalVaultWrite = vi.fn()
      const { result } = renderDeleteActions({ onInternalVaultWrite })

      act(() => {
        result.current.handleBulkDeletePermanently(['/vault/a.md', '/vault/b.md'])
      })
      await confirmCurrentDelete(result)

      expect(onInternalVaultWrite).toHaveBeenCalledWith('/vault/a.md')
      expect(onInternalVaultWrite).toHaveBeenCalledWith('/vault/b.md')
    })

    it('does not mark paths as internal writes when the delete fails', async () => {
      mockInvokeFn.mockRejectedValue(new Error('disk full'))
      const onInternalVaultWrite = vi.fn()
      const { result } = renderDeleteActions({ onInternalVaultWrite })

      await act(async () => {
        await result.current.deleteNoteFromDisk('/vault/a.md')
      })

      expect(onInternalVaultWrite).not.toHaveBeenCalled()
    })

    it('marks pruned orphaned attachment paths as internal writes too', async () => {
      isTauriFn.mockReturnValue(true)
      invokeFn.mockImplementation(async (command: string, args: { paths?: string[] }) =>
        command === 'batch_delete_notes_async' ? args.paths : undefined,
      )
      const onInternalVaultWrite = vi.fn()
      const entries = [
        { path: '/vault/a.md', title: 'A', attachmentLinks: ['attachments/gone.png'] },
      ] as VaultEntry[]

      const { result } = renderHook(() =>
        useDeleteActions({
          onDeselectNote,
          onInternalVaultWrite,
          removeEntry,
          removeEntries,
          refreshModifiedFiles,
          reloadVault,
          setToastMessage,
          entries,
          vaultPath: '/vault',
        }),
      )

      await act(async () => {
        await result.current.deleteNoteFromDisk('/vault/a.md')
      })

      expect(onInternalVaultWrite).toHaveBeenCalledWith('attachments/gone.png')
    })
  })

  // --- setConfirmDelete ---

  describe('setConfirmDelete', () => {
    it('can clear confirmDelete via setConfirmDelete(null)', async () => {
      const { result } = renderDeleteActions()
      await openDeleteDialog(result, ['/vault/a.md'])
      expect(result.current.confirmDelete).not.toBeNull()
      act(() => {
        result.current.setConfirmDelete(null)
      })
      expect(result.current.confirmDelete).toBeNull()
    })
  })
})
