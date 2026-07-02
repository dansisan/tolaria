import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorSaveWithLinks } from './useEditorSaveWithLinks'

const mockHandleContentChange = vi.fn()
const mockHandleSave = vi.fn()
const mockSavePendingForPath = vi.fn()

type UpdateVaultContent = (path: string, content: string) => void
let capturedUpdateVaultContent: UpdateVaultContent | null = null

vi.mock('./useEditorSave', () => ({
  useEditorSave: vi.fn((config: { updateVaultContent: UpdateVaultContent }) => {
    capturedUpdateVaultContent = config.updateVaultContent
    return {
      handleContentChange: mockHandleContentChange,
      handleSave: mockHandleSave,
      savePendingForPath: mockSavePendingForPath,
    }
  }),
}))

describe('useEditorSaveWithLinks', () => {
  let updateEntry: Mock
  let setTabs: Mock
  let setToastMessage: Mock
  let onAfterSave: Mock

  beforeEach(() => {
    updateEntry = vi.fn()
    setTabs = vi.fn()
    setToastMessage = vi.fn()
    onAfterSave = vi.fn()
    capturedUpdateVaultContent = null
    mockHandleContentChange.mockClear()
    mockHandleSave.mockClear()
    mockSavePendingForPath.mockClear()
  })

  function renderHookWithLinks() {
    return renderHook(() =>
      useEditorSaveWithLinks({
        updateEntry,
        setTabs,
        setToastMessage,
        onAfterSave,
      }),
    )
  }

  /** Invoke the save-time callback wired into useEditorSave. */
  function persist(path: string, content: string) {
    act(() => {
      capturedUpdateVaultContent?.(path, content)
    })
  }

  it('handleContentChange delegates to useEditorSave without touching the store', () => {
    const { result } = renderHookWithLinks()

    act(() => {
      result.current.handleContentChange('/note.md', 'see [[PageA]]')
    })

    expect(mockHandleContentChange).toHaveBeenCalledWith('/note.md', 'see [[PageA]]')
    // Typing must not write to the vault store — that is deferred to save time.
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('persisting a note writes the full metadata patch to the store once', () => {
    renderHookWithLinks()

    persist('/note.md', 'see [[PageA]] and [[PageB]]')

    expect(updateEntry).toHaveBeenCalledTimes(1)
    expect(updateEntry).toHaveBeenCalledWith('/note.md', expect.objectContaining({
      outgoingLinks: ['PageA', 'PageB'],
      attachmentLinks: [],
      title: 'note',
      hasH1: false,
    }))
  })

  it('stamps a numeric modifiedAt timestamp on the persisted patch', () => {
    renderHookWithLinks()

    persist('/note.md', 'plain text no links')

    const patch = updateEntry.mock.calls[0][1]
    expect(typeof patch.modifiedAt).toBe('number')
  })

  it('spreads all properties from useEditorSave onto the return value', () => {
    const { result } = renderHookWithLinks()

    expect(result.current.handleSave).toBeDefined()
    expect(result.current.savePendingForPath).toBeDefined()
  })
})
