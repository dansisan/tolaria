import { useState, useCallback, useRef } from 'react'
import type { VaultEntry } from '../types'

export interface MultiSelectState {
  selectedPaths: Set<string>
  /** Explicit "bulk mode": checkboxes shown and clicks toggle selection, even with nothing selected yet. */
  bulkMode: boolean
  isMultiSelecting: boolean
  toggle: (path: string) => void
  selectRange: (toPath: string) => void
  clear: () => void
  /** Enter bulk mode if off, otherwise exit and deselect everything. */
  toggleBulkMode: () => void
  setAnchor: (path: string) => void
  selectAll: () => void
}

export function useMultiSelect(visibleEntries: VaultEntry[], activePath: string | null = null): MultiSelectState {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const lastClickedRef = useRef<string | null>(null)

  const toggle = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    lastClickedRef.current = path
  }, [])

  const selectRange = useCallback((toPath: string) => {
    const fromPath = lastClickedRef.current ?? activePath
    if (!fromPath) {
      toggle(toPath)
      return
    }
    const paths = visibleEntries.map((e) => e.path)
    const fromIdx = paths.indexOf(fromPath)
    const toIdx = paths.indexOf(toPath)
    if (fromIdx === -1 || toIdx === -1) {
      toggle(toPath)
      return
    }
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      for (let i = start; i <= end; i++) {
        const path = paths.at(i)
        if (path) next.add(path)
      }
      return next
    })
    lastClickedRef.current = toPath
  }, [visibleEntries, activePath, toggle])

  const clear = useCallback(() => {
    setSelectedPaths(new Set())
    setBulkMode(false)
    lastClickedRef.current = null
  }, [])

  const toggleBulkMode = useCallback(() => {
    setBulkMode((prev) => {
      if (prev) {
        setSelectedPaths(new Set())
        lastClickedRef.current = null
      }
      return !prev
    })
  }, [])

  const setAnchor = useCallback((path: string) => {
    lastClickedRef.current = path
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(visibleEntries.map((e) => e.path)))
  }, [visibleEntries])

  return {
    selectedPaths,
    bulkMode,
    isMultiSelecting: bulkMode || selectedPaths.size > 0,
    toggle,
    selectRange,
    clear,
    toggleBulkMode,
    setAnchor,
    selectAll,
  }
}
