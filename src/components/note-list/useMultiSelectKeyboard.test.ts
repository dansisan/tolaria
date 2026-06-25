import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useMultiSelectKeyboard } from './useMultiSelectKeyboard'
import type { MultiSelectState } from '../../hooks/useMultiSelect'

function makeMultiSelect(overrides: Partial<MultiSelectState> = {}): MultiSelectState {
  return {
    selectedPaths: new Set<string>(),
    bulkMode: false,
    isMultiSelecting: false,
    toggle: vi.fn(),
    selectRange: vi.fn(),
    clear: vi.fn(),
    toggleBulkMode: vi.fn(),
    setAnchor: vi.fn(),
    selectAll: vi.fn(),
    ...overrides,
  }
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('useMultiSelectKeyboard space/x toggle', () => {
  it('toggles the highlighted note on Space while in bulk mode', () => {
    const multiSelect = makeMultiSelect({ bulkMode: true, isMultiSelecting: true })
    renderHook(() => useMultiSelectKeyboard({ multiSelect, isEntityView: false, highlightedPath: 'b.md' }))

    press(' ')
    expect(multiSelect.toggle).toHaveBeenCalledWith('b.md')
  })

  it('toggles the highlighted note on x while in bulk mode', () => {
    const multiSelect = makeMultiSelect({ bulkMode: true, isMultiSelecting: true })
    renderHook(() => useMultiSelectKeyboard({ multiSelect, isEntityView: false, highlightedPath: 'c.md' }))

    press('x')
    expect(multiSelect.toggle).toHaveBeenCalledWith('c.md')
  })

  it('does nothing when not in bulk mode', () => {
    const multiSelect = makeMultiSelect({ bulkMode: false })
    renderHook(() => useMultiSelectKeyboard({ multiSelect, isEntityView: false, highlightedPath: 'b.md' }))

    press(' ')
    expect(multiSelect.toggle).not.toHaveBeenCalled()
  })

  it('does nothing when there is no highlighted row', () => {
    const multiSelect = makeMultiSelect({ bulkMode: true, isMultiSelecting: true })
    renderHook(() => useMultiSelectKeyboard({ multiSelect, isEntityView: false, highlightedPath: null }))

    press(' ')
    expect(multiSelect.toggle).not.toHaveBeenCalled()
  })

  it('clears (and exits bulk mode) on Escape', () => {
    const multiSelect = makeMultiSelect({ bulkMode: true, isMultiSelecting: true })
    renderHook(() => useMultiSelectKeyboard({ multiSelect, isEntityView: false }))

    press('Escape')
    expect(multiSelect.clear).toHaveBeenCalled()
  })
})
