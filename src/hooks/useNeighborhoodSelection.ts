import { useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { SidebarSelection, VaultEntry } from '../types'
import type { NoteListFilter } from '../utils/noteListHelpers'
import { trackEvent } from '../lib/telemetry'
import {
  focusNoteListContainer,
  isEditableElement,
  isEditorEscapeTarget,
  popNeighborhoodHistory,
  pushNeighborhoodHistory,
  resolveNeighborhoodSelection,
  shouldProcessEscapeNavigation,
} from '../utils/neighborhoodHistory'

interface SetSelectionOptions {
  preserveNeighborhoodHistory?: boolean
}

type SetSelection = (selection: SidebarSelection, options?: SetSelectionOptions) => void

interface NeighborhoodRefs {
  neighborhoodHistoryRef: MutableRefObject<SidebarSelection[]>
  selectionRef: MutableRefObject<SidebarSelection>
}

interface UseNeighborhoodEntryOptions extends NeighborhoodRefs {
  setSelection: SetSelection
}

interface UseSelectionSanitizerOptions extends NeighborhoodRefs {
  effectiveSelection: SidebarSelection
  selection: SidebarSelection
  setNoteListFilter: (filter: NoteListFilter) => void
  setSelection: (selection: SidebarSelection) => void
}

interface UseNeighborhoodHistoryBackOptions {
  neighborhoodHistoryRef: MutableRefObject<SidebarSelection[]>
  setSelection: SetSelection
}

interface UseEscapeNavigationOptions {
  /** Runs when Escape should navigate; returns true if it consumed the event. */
  onEscape: () => boolean
  shouldBlockEscape: boolean
}

export function focusNoteListOnNextFrame(): void {
  requestAnimationFrame(() => {
    focusNoteListContainer(document)
  })
}

export function useNeighborhoodEntry({
  neighborhoodHistoryRef,
  selectionRef,
  setSelection,
}: UseNeighborhoodEntryOptions) {
  return useCallback((entry: VaultEntry) => {
    const currentSelection = selectionRef.current
    const nextSelection = resolveNeighborhoodSelection(currentSelection, entry)
    trackEvent('neighborhood_mode_toggled', { action: nextSelection.action })

    if (nextSelection.action === 'exit') {
      const { previousSelection, nextHistory } = popNeighborhoodHistory(neighborhoodHistoryRef.current)
      neighborhoodHistoryRef.current = nextHistory
      setSelection(previousSelection ?? nextSelection.selection, previousSelection ? { preserveNeighborhoodHistory: true } : undefined)
      focusNoteListOnNextFrame()
      return
    }

    neighborhoodHistoryRef.current = pushNeighborhoodHistory(
      neighborhoodHistoryRef.current,
      currentSelection,
      nextSelection.selection,
    )
    setSelection(nextSelection.selection, { preserveNeighborhoodHistory: true })
  }, [neighborhoodHistoryRef, selectionRef, setSelection])
}

export function useSelectionSanitizer({
  effectiveSelection,
  neighborhoodHistoryRef,
  selection,
  selectionRef,
  setNoteListFilter,
  setSelection,
}: UseSelectionSanitizerOptions): void {
  useEffect(() => {
    selectionRef.current = effectiveSelection
  }, [effectiveSelection, selectionRef])

  useEffect(() => {
    if (effectiveSelection === selection) return

    if (effectiveSelection.kind !== 'entity') {
      neighborhoodHistoryRef.current = []
    }
    setSelection(effectiveSelection)
    setNoteListFilter('open')
  }, [effectiveSelection, neighborhoodHistoryRef, selection, setNoteListFilter, setSelection])
}

export function useNeighborhoodHistoryBack({
  neighborhoodHistoryRef,
  setSelection,
}: UseNeighborhoodHistoryBackOptions) {
  return useCallback(() => {
    const { previousSelection, nextHistory } = popNeighborhoodHistory(neighborhoodHistoryRef.current)
    if (!previousSelection) return false

    neighborhoodHistoryRef.current = nextHistory
    setSelection(previousSelection, { preserveNeighborhoodHistory: true })
    focusNoteListOnNextFrame()
    return true
  }, [neighborhoodHistoryRef, setSelection])
}

/**
 * The BlockNote (rich) editor handles Escape itself: it blurs to `<body>` and
 * calls `preventDefault` before the window-level navigation handler runs, so
 * focus is dropped rather than handed to the note list — leaving the list
 * looking inactive. This capture-phase listener notes when Escape fires from an
 * editor surface and, only if the editor was actually dropped to `<body>` (not
 * a menu/toolbar close that keeps editor focus), routes focus to the note list
 * so keyboard navigation visibly resumes there. Raw mode already focuses the
 * list in its own Escape handler, so the `<body>` guard makes this a no-op there.
 */
function useEditorEscapeRefocus(): void {
  useEffect(() => {
    const handleEscapeCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.metaKey || event.ctrlKey || event.altKey) return
      if (!isEditorEscapeTarget(document.activeElement)) return
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active === null || active === document.body) focusNoteListContainer(document)
      })
    }

    window.addEventListener('keydown', handleEscapeCapture, true)
    return () => window.removeEventListener('keydown', handleEscapeCapture, true)
  }, [])
}

/**
 * Global Escape navigation. When no higher-priority surface owns the key
 * (dialog, search, multi-select, focused editor/input), Escape runs `onEscape`,
 * which steps back through neighborhood history or returns to the main note
 * list. A focused editor is blurred first so a second Escape can navigate.
 */
export function useEscapeNavigation({
  onEscape,
  shouldBlockEscape,
}: UseEscapeNavigationOptions): void {
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!shouldProcessEscapeNavigation(event, shouldBlockEscape)) return

      const activeElement = document.activeElement
      if (isEditorEscapeTarget(activeElement)) {
        event.preventDefault()
        activeElement.blur()
        focusNoteListOnNextFrame()
        return
      }

      if (isEditableElement(activeElement)) return

      if (onEscape()) {
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [onEscape, shouldBlockEscape])

  useEditorEscapeRefocus()
}
