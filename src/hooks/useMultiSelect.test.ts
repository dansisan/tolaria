import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMultiSelect } from './useMultiSelect'
import type { VaultEntry } from '../types'

function entry(path: string): VaultEntry {
  return { path, name: path, fileKind: 'text' } as VaultEntry
}

const ENTRIES = [entry('a.md'), entry('b.md'), entry('c.md')]

describe('useMultiSelect bulk mode', () => {
  it('is not multi-selecting by default', () => {
    const { result } = renderHook(() => useMultiSelect(ENTRIES))
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.isMultiSelecting).toBe(false)
  })

  it('entering bulk mode makes it multi-selecting with no selection', () => {
    const { result } = renderHook(() => useMultiSelect(ENTRIES))
    act(() => result.current.toggleBulkMode())
    expect(result.current.bulkMode).toBe(true)
    expect(result.current.isMultiSelecting).toBe(true)
    expect(result.current.selectedPaths.size).toBe(0)
  })

  it('toggling bulk mode off clears the selection', () => {
    const { result } = renderHook(() => useMultiSelect(ENTRIES))
    act(() => result.current.toggleBulkMode())
    act(() => result.current.toggle('a.md'))
    expect(result.current.selectedPaths.has('a.md')).toBe(true)
    act(() => result.current.toggleBulkMode())
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.isMultiSelecting).toBe(false)
    expect(result.current.selectedPaths.size).toBe(0)
  })

  it('clear() exits bulk mode and empties the selection', () => {
    const { result } = renderHook(() => useMultiSelect(ENTRIES))
    act(() => result.current.toggleBulkMode())
    act(() => result.current.toggle('a.md'))
    act(() => result.current.clear())
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.selectedPaths.size).toBe(0)
  })

  it('a non-empty selection is multi-selecting even without bulk mode', () => {
    const { result } = renderHook(() => useMultiSelect(ENTRIES))
    act(() => result.current.toggle('b.md'))
    expect(result.current.bulkMode).toBe(false)
    expect(result.current.isMultiSelecting).toBe(true)
  })
})
