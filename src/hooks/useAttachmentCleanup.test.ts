import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useAttachmentCleanup } from './useAttachmentCleanup'
import { ATTACHMENTS_UNLINKED_EVENT } from './useSaveNote'

let tauriMode = true
vi.mock('../mock-tauri', () => ({ isTauri: () => tauriMode }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))

const { invoke } = await import('@tauri-apps/api/core')
const invokeFn = invoke as ReturnType<typeof vi.fn>

function note(path: string, attachmentLinks: string[]): VaultEntry {
  return { path, title: path, attachmentLinks } as VaultEntry
}

function emitUnlinked(notePath: string, removedLinks: string[]) {
  window.dispatchEvent(new CustomEvent(ATTACHMENTS_UNLINKED_EVENT, { detail: { notePath, removedLinks } }))
}

describe('useAttachmentCleanup', () => {
  beforeEach(() => {
    tauriMode = true
    invokeFn.mockClear()
  })
  afterEach(() => {
    invokeFn.mockReset()
    invokeFn.mockResolvedValue(undefined)
  })

  it('deletes an orphaned image attachment', () => {
    renderHook(() => useAttachmentCleanup({ entries: [note('a.md', [])], vaultPath: '/vault' }))

    emitUnlinked('a.md', ['attachments/gone.webp'])

    expect(invokeFn).toHaveBeenCalledWith('delete_attachment', {
      vaultPath: '/vault',
      attachmentPath: 'attachments/gone.webp',
    })
  })

  it('marks the deleted attachment as an internal write so the watcher ignores it', () => {
    const onInternalVaultWrite = vi.fn()
    renderHook(() => useAttachmentCleanup({
      entries: [note('a.md', [])],
      vaultPath: '/vault',
      onInternalVaultWrite,
    }))

    emitUnlinked('a.md', ['attachments/gone.webp'])

    expect(onInternalVaultWrite).toHaveBeenCalledWith('/vault/attachments/gone.webp')
  })

  it('marks the internal write before invoking the delete so the suppression window covers the event', () => {
    const calls: string[] = []
    const onInternalVaultWrite = vi.fn(() => { calls.push('mark') })
    invokeFn.mockImplementation(() => { calls.push('delete'); return Promise.resolve(undefined) })
    renderHook(() => useAttachmentCleanup({
      entries: [note('a.md', [])],
      vaultPath: '/vault',
      onInternalVaultWrite,
    }))

    emitUnlinked('a.md', ['attachments/gone.webp'])

    expect(calls).toEqual(['mark', 'delete'])
  })

  it('does not mark anything when no attachment is orphaned', () => {
    const onInternalVaultWrite = vi.fn()
    const entries = [note('a.md', []), note('b.md', ['attachments/shared.png'])]
    renderHook(() => useAttachmentCleanup({ entries, vaultPath: '/vault', onInternalVaultWrite }))

    emitUnlinked('a.md', ['attachments/shared.png'])

    expect(onInternalVaultWrite).not.toHaveBeenCalled()
  })

  it('keeps images still referenced by another note', () => {
    const entries = [note('a.md', []), note('b.md', ['attachments/shared.png'])]
    renderHook(() => useAttachmentCleanup({ entries, vaultPath: '/vault' }))

    emitUnlinked('a.md', ['attachments/shared.png'])

    expect(invokeFn).not.toHaveBeenCalled()
  })

  it('does nothing outside Tauri', () => {
    tauriMode = false
    renderHook(() => useAttachmentCleanup({ entries: [], vaultPath: '/vault' }))

    emitUnlinked('a.md', ['attachments/gone.webp'])

    expect(invokeFn).not.toHaveBeenCalled()
  })

  it('stops handling events after unmount', () => {
    const { unmount } = renderHook(() => useAttachmentCleanup({ entries: [], vaultPath: '/vault' }))
    unmount()

    emitUnlinked('a.md', ['attachments/gone.webp'])

    expect(invokeFn).not.toHaveBeenCalled()
  })
})
