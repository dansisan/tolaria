import { useState, useCallback, useEffect, useRef } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import type { VaultEntry } from '../types'
import { logKeyboardNavigationTrace } from '../utils/noteOpenPerformance'
import { trackEvent } from '../lib/telemetry'

/**
 * Diagnostic only: logs the elapsed time from an ArrowUp/ArrowDown press in
 * the note list to the moment that note's content actually finishes
 * rendering (the same 'laputa:editor-tab-swapped' event useEditorTabSwap
 * dispatches on swap completion), so the up/down-to-render gap is directly
 * visible in the console without a profiler.
 */
function logNextRenderAfterArrowKey(path: string, pressedAt: number): void {
  const cleanup = () => {
    window.removeEventListener('laputa:editor-tab-swapped', handleSwap)
    clearTimeout(giveUpTimer)
  }
  const handleSwap = (event: Event) => {
    const detail = (event as CustomEvent<{ path?: string }>).detail
    if (detail?.path !== path) return
    cleanup()
    console.log(`[diag] arrow-key -> render path=${path} elapsed=${(performance.now() - pressedAt).toFixed(1)}ms`)
  }
  // Rapid key repeats can coalesce this exact path out of ever opening (see
  // useScheduledOpen) — give up instead of leaking the listener forever.
  const giveUpTimer = setTimeout(cleanup, 5_000)
  window.addEventListener('laputa:editor-tab-swapped', handleSwap)
}

/** A VaultEntry date field a note list can be sorted/navigated by. */
type JumpDateField = 'createdAt' | 'modifiedAt'

/** The list's current sort direction — determines which physical direction (up/down the list) moves forward vs backward in time. */
type JumpDateListDirection = 'asc' | 'desc'

interface NoteListKeyboardOptions {
  items: VaultEntry[]
  selectedNotePath: string | null
  onOpen: (entry: VaultEntry) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
  onPrefetch?: (entry: VaultEntry) => void
  searchVisible?: boolean
  toggleSearch?: () => void
  enabled: boolean
  onFocusEditorOnEnter?: (path: string) => void
  /** Called when ArrowUp is pressed while the first item is highlighted (e.g. to return focus to a search input above the list). */
  onExitTop?: () => void
  /** The date field the list is currently sorted by, enabling Cmd+Shift+Up/Down year-jump. `undefined` disables it (e.g. sorted by title/status). */
  jumpDateField?: JumpDateField
  /** The list's current sort direction — 'desc' (newest first) means jumping toward the bottom of the list goes further back in time. Defaults to 'desc'. */
  jumpDateListDirection?: JumpDateListDirection
}

interface ItemIndex {
  entryByPath: Map<string, VaultEntry>
  indexByPath: Map<string, number>
}

const itemIndexCache = new WeakMap<VaultEntry[], ItemIndex>()

function buildItemIndex(items: VaultEntry[]): ItemIndex {
  const entryByPath = new Map<string, VaultEntry>()
  const indexByPath = new Map<string, number>()

  for (const [index, entry] of items.entries()) {
    entryByPath.set(entry.path, entry)
    indexByPath.set(entry.path, index)
  }

  return { entryByPath, indexByPath }
}

function getItemIndex(items: VaultEntry[]): ItemIndex {
  const cached = itemIndexCache.get(items)
  if (cached) return cached

  const nextIndex = buildItemIndex(items)
  itemIndexCache.set(items, nextIndex)
  return nextIndex
}

function resolveHighlightedPath(items: VaultEntry[], selectedNotePath: string | null): string | null {
  if (items.length === 0) return null
  if (!selectedNotePath) return items[0].path

  return getItemIndex(items).entryByPath.has(selectedNotePath)
    ? selectedNotePath
    : items[0].path
}

function isListActive(container: HTMLDivElement | null): boolean {
  if (!container) return false
  const activeElement = document.activeElement
  return activeElement instanceof Node && container.contains(activeElement)
}

function isPanelActive(panel: HTMLDivElement | null): boolean {
  if (!panel) return false
  const activeElement = document.activeElement
  return activeElement instanceof Node && panel.contains(activeElement)
}

function isEditableElement(element: Element | null): boolean {
  if (!element) return false
  if (
    element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  ) return true
  if (!(element instanceof HTMLElement)) return false
  return element.isContentEditable || !!element.closest('[contenteditable="true"]')
}

function isInteractiveElement(element: Element | null): boolean {
  if (!element) return false
  if (isEditableElement(element)) return true
  return element.tagName === 'BUTTON'
    || element.tagName === 'A'
    || element.getAttribute('role') === 'button'
}

function isNestedInteractiveTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  return target instanceof Element
    && currentTarget instanceof Element
    && target !== currentTarget
    && currentTarget.contains(target)
    && isInteractiveElement(target)
}

function resolveCurrentIndex(
  items: VaultEntry[],
  highlightedPath: string | null,
  selectedNotePath: string | null,
): number {
  const activePath = highlightedPath ?? selectedNotePath
  if (!activePath) return -1
  return getItemIndex(items).indexByPath.get(activePath) ?? -1
}

function moveHighlightIndex(
  previousIndex: number,
  direction: 1 | -1,
  itemCount: number,
): number {
  if (itemCount === 0) return -1
  if (previousIndex < 0) return direction === 1 ? 0 : itemCount - 1

  const currentIndex = Math.min(previousIndex, itemCount - 1)
  const nextIndex = currentIndex + direction
  if (nextIndex < 0 || nextIndex >= itemCount) return previousIndex
  return nextIndex
}

function resolveHighlightedEntry(items: VaultEntry[], highlightedPath: string | null): VaultEntry | undefined {
  if (!highlightedPath) return undefined
  return getItemIndex(items).entryByPath.get(highlightedPath)
}

function usesCommandModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return event.metaKey || event.ctrlKey
}

function isToggleSearchShortcut(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  if (!usesCommandModifier(event) || event.altKey || event.shiftKey) return false
  return event.code === 'KeyF' || event.key.toLowerCase() === 'f'
}

function isNeighborhoodKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return event.key === 'Enter' && usesCommandModifier(event) && !event.altKey
}

function useKeyboardItemRefs(items: VaultEntry[], selectedNotePath: string | null) {
  const itemsRef = useRef(items)
  const selectedNotePathRef = useRef(selectedNotePath)

  useEffect(() => {
    itemsRef.current = items
    selectedNotePathRef.current = selectedNotePath
  }, [items, selectedNotePath])

  return { itemsRef, selectedNotePathRef }
}

function useHighlightedPath() {
  const [highlightedPathState, setHighlightedPath] = useState<string | null>(null)
  const highlightedPathRef = useRef<string | null>(null)

  const syncHighlightedPath = useCallback((nextPath: string | null) => {
    highlightedPathRef.current = nextPath
    setHighlightedPath(nextPath)
  }, [])

  return { highlightedPathRef, highlightedPathState, syncHighlightedPath }
}

function useSelectionSync(
  itemsRef: React.RefObject<VaultEntry[]>,
  selectedNotePathRef: React.RefObject<string | null>,
  syncHighlightedPath: (nextPath: string | null) => void,
) {
  return useCallback(() => {
    syncHighlightedPath(resolveHighlightedPath(itemsRef.current, selectedNotePathRef.current))
  }, [itemsRef, selectedNotePathRef, syncHighlightedPath])
}

interface ScheduledOpenState {
  entry: VaultEntry | null
  frameId: number | null
}

function cancelScheduledOpen(stateRef: React.RefObject<ScheduledOpenState>): void {
  const frameId = stateRef.current.frameId
  if (frameId !== null) cancelAnimationFrame(frameId)
  stateRef.current.entry = null
  stateRef.current.frameId = null
}

function flushScheduledOpen(
  stateRef: React.RefObject<ScheduledOpenState>,
  onOpen: (entry: VaultEntry) => void,
  entry?: VaultEntry,
): void {
  if (entry) stateRef.current.entry = entry
  const nextEntry = stateRef.current.entry
  if (!nextEntry) return

  if (stateRef.current.frameId !== null) cancelAnimationFrame(stateRef.current.frameId)
  stateRef.current.entry = null
  stateRef.current.frameId = null
  onOpen(nextEntry)
}

function scheduleOpenForNextFrame(
  stateRef: React.RefObject<ScheduledOpenState>,
  onOpen: (entry: VaultEntry) => void,
  entry: VaultEntry,
): void {
  stateRef.current.entry = entry
  if (stateRef.current.frameId !== null) return

  stateRef.current.frameId = requestAnimationFrame(() => {
    flushScheduledOpen(stateRef, onOpen)
  })
}

function useScheduledOpen(onOpen: (entry: VaultEntry) => void, enabled: boolean) {
  const stateRef = useRef<ScheduledOpenState>({ entry: null, frameId: null })

  const scheduleOpen = useCallback((entry: VaultEntry) => {
    scheduleOpenForNextFrame(stateRef, onOpen, entry)
  }, [onOpen])

  const flushOpen = useCallback((entry?: VaultEntry) => {
    flushScheduledOpen(stateRef, onOpen, entry)
  }, [onOpen])

  const cancelOpen = useCallback(() => {
    cancelScheduledOpen(stateRef)
  }, [])

  useEffect(() => {
    if (enabled) return
    cancelOpen()
  }, [cancelOpen, enabled])

  useEffect(() => cancelOpen, [cancelOpen])

  return { cancelOpen, flushOpen, scheduleOpen }
}

/** ArrowUp on the first highlighted item leaves the list instead of clamping. */
function isExitTopMove(direction: 1 | -1, currentIndex: number): boolean {
  return direction === -1 && currentIndex === 0
}

function useMoveHighlight({
  items,
  selectedNotePath,
  highlightedPathRef,
  syncHighlightedPath,
  virtuosoRef,
  onPrefetch,
  scheduleOpen,
  onExitTop,
}: {
  items: VaultEntry[]
  selectedNotePath: string | null
  highlightedPathRef: React.RefObject<string | null>
  syncHighlightedPath: (nextPath: string | null) => void
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onPrefetch?: (entry: VaultEntry) => void
  scheduleOpen: (entry: VaultEntry) => void
  onExitTop?: () => void
}) {
  return useCallback((direction: 1 | -1) => {
    const startedAt = performance.now()
    const currentIndex = resolveCurrentIndex(items, highlightedPathRef.current, selectedNotePath)
    if (isExitTopMove(direction, currentIndex)) {
      onExitTop?.()
      return
    }
    const nextIndex = moveHighlightIndex(currentIndex, direction, items.length)
    const currentPath = highlightedPathRef.current ?? selectedNotePath
    const nextItem = items.at(nextIndex)
    if (!nextItem || nextItem.path === currentPath) return

    syncHighlightedPath(nextItem.path)
    virtuosoRef.current?.scrollIntoView({ index: nextIndex, behavior: 'auto' })
    scheduleOpen(nextItem)
    onPrefetch?.(nextItem)
    logNextRenderAfterArrowKey(nextItem.path, startedAt)
    logKeyboardNavigationTrace(direction === 1 ? 'down' : 'up', items.length, performance.now() - startedAt)
  }, [highlightedPathRef, items, onExitTop, onPrefetch, scheduleOpen, selectedNotePath, syncHighlightedPath, virtuosoRef])
}

function entryDateMs(entry: VaultEntry, field: JumpDateField): number | null {
  const seconds = entry[field]
  return seconds == null ? null : seconds * 1000
}

/** The entry (and its index) whose `field` value is closest to `targetMs`, ignoring entries without that field. */
function findNearestByDate(
  items: VaultEntry[],
  targetMs: number,
  field: JumpDateField,
): { entry: VaultEntry; index: number } | null {
  let best: { entry: VaultEntry; index: number; diff: number } | null = null

  for (const [index, entry] of items.entries()) {
    const ms = entryDateMs(entry, field)
    if (ms === null) continue
    const diff = Math.abs(ms - targetMs)
    if (!best || diff < best.diff) best = { entry, index, diff }
  }

  return best && { entry: best.entry, index: best.index }
}

function useJumpToDate({
  items,
  syncHighlightedPath,
  virtuosoRef,
  onPrefetch,
  scheduleOpen,
}: {
  items: VaultEntry[]
  syncHighlightedPath: (nextPath: string | null) => void
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onPrefetch?: (entry: VaultEntry) => void
  scheduleOpen: (entry: VaultEntry) => void
}) {
  return useCallback((targetMs: number, field: JumpDateField) => {
    const nearest = findNearestByDate(items, targetMs, field)
    if (!nearest) return

    syncHighlightedPath(nearest.entry.path)
    virtuosoRef.current?.scrollToIndex({ index: nearest.index, align: 'center', behavior: 'auto' })
    scheduleOpen(nearest.entry)
    onPrefetch?.(nearest.entry)
  }, [items, onPrefetch, scheduleOpen, syncHighlightedPath, virtuosoRef])
}

/**
 * `direction` is always physical (which way through the currently displayed list), not
 * temporal — matching how ArrowUp/ArrowDown already navigate the list regardless of sort
 * direction. Whether "toward the bottom" means older or newer depends on `listDirection`:
 * descending (newest first) means down the list is further into the past.
 */
function yearDeltaForJump(direction: 'up' | 'down', listDirection: JumpDateListDirection): 1 | -1 {
  const towardBottom = direction === 'down'
  const bottomIsForward = listDirection === 'asc'
  return towardBottom === bottomIsForward ? 1 : -1
}

function useJumpByYear({
  items,
  selectedNotePath,
  highlightedPathRef,
  jumpDateField,
  jumpDateListDirection = 'desc',
  jumpToDate,
}: {
  items: VaultEntry[]
  selectedNotePath: string | null
  highlightedPathRef: React.RefObject<string | null>
  jumpDateField?: JumpDateField
  jumpDateListDirection?: JumpDateListDirection
  jumpToDate: (targetMs: number, field: JumpDateField) => void
}) {
  return useCallback((direction: 'up' | 'down') => {
    if (!jumpDateField) return

    const currentEntry = resolveHighlightedEntry(items, highlightedPathRef.current ?? selectedNotePath)
    const currentMs = currentEntry ? entryDateMs(currentEntry, jumpDateField) : null
    if (currentMs === null) return

    const target = new Date(currentMs)
    target.setFullYear(target.getFullYear() + yearDeltaForJump(direction, jumpDateListDirection))
    jumpToDate(target.getTime(), jumpDateField)
  }, [highlightedPathRef, items, jumpDateField, jumpDateListDirection, jumpToDate, selectedNotePath])
}

type ListEdge = 'top' | 'bottom'

function useJumpToEdge({
  items,
  syncHighlightedPath,
  virtuosoRef,
  onPrefetch,
  scheduleOpen,
}: {
  items: VaultEntry[]
  syncHighlightedPath: (nextPath: string | null) => void
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onPrefetch?: (entry: VaultEntry) => void
  scheduleOpen: (entry: VaultEntry) => void
}) {
  return useCallback((edge: ListEdge) => {
    if (items.length === 0) return
    const index = edge === 'top' ? 0 : items.length - 1
    const item = items[index]
    if (!item) return
    syncHighlightedPath(item.path)
    virtuosoRef.current?.scrollToIndex({ index, align: edge === 'top' ? 'start' : 'end', behavior: 'auto' })
    scheduleOpen(item)
    onPrefetch?.(item)
  }, [items, onPrefetch, scheduleOpen, syncHighlightedPath, virtuosoRef])
}

/** Home / Cmd+Up jump to the top; End / Cmd+Down jump to the bottom. */
function resolveJumpEdge(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): ListEdge | null {
  if (event.altKey || event.shiftKey) return null
  if (event.key === 'Home' && !event.metaKey && !event.ctrlKey) return 'top'
  if (event.key === 'End' && !event.metaKey && !event.ctrlKey) return 'bottom'
  if (usesCommandModifier(event) && event.key === 'ArrowUp') return 'top'
  if (usesCommandModifier(event) && event.key === 'ArrowDown') return 'bottom'
  return null
}

type JumpYearDirection = 'up' | 'down'

/**
 * Cmd+Shift+Up/Down jump a year through the list, physically (same up/down-the-list
 * sense as plain arrow navigation) — whether that's back or forward in time depends on
 * sort direction, resolved in `yearDeltaForJump`. Distinguished from Cmd+Up/Down (edge
 * jump) by the Shift key.
 */
function resolveJumpYearDirection(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): JumpYearDirection | null {
  if (!usesCommandModifier(event) || !event.shiftKey || event.altKey) return null
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'
  return null
}

function resolveEntryForActivation(
  items: VaultEntry[],
  highlightedPathRef: React.RefObject<string | null>,
): VaultEntry | undefined {
  return resolveHighlightedEntry(items, highlightedPathRef.current)
}

function handleNeighborhoodActivation(options: {
  event: Pick<KeyboardEvent, 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  } = options

  const highlightedItem = resolveEntryForActivation(items, highlightedPathRef)
  if (!highlightedItem) return false

  event.preventDefault()
  cancelOpen()
  void onEnterNeighborhood?.(highlightedItem)
  return true
}

function handleArrowNavigation(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  moveHighlight: (direction: 1 | -1) => void,
): boolean {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(1)
    return true
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-1)
    return true
  }

  return false
}

function handleHighlightedOpen(options: {
  event: Pick<KeyboardEvent, 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  flushOpen: (entry?: VaultEntry) => void
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    flushOpen,
  } = options

  const highlightedItem = resolveEntryForActivation(items, highlightedPathRef)
  if (!highlightedItem) return false

  event.preventDefault()
  flushOpen(highlightedItem)
  return true
}

function useProcessKeyDown({
  enabled,
  items,
  highlightedPathRef,
  moveHighlight,
  jumpToEdge,
  jumpByYear,
  flushOpen,
  cancelOpen,
  onEnterNeighborhood,
  onToggleSearchShortcut,
  onEscapeWhileSearching,
  onFocusEditorOnEnter,
}: {
  enabled: boolean
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  moveHighlight: (direction: 1 | -1) => void
  jumpToEdge: (edge: ListEdge) => void
  jumpByYear: (direction: JumpYearDirection) => void
  flushOpen: (entry?: VaultEntry) => void
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
  onToggleSearchShortcut?: () => void
  onEscapeWhileSearching?: () => boolean
  onFocusEditorOnEnter?: (path: string) => void
}) {
  return useCallback((event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>) => {
    if (!enabled) return

    // Escape closes an open search and returns to the unfiltered list, even when
    // focus has moved from the search box into the results (via ArrowDown).
    if (event.key === 'Escape') {
      if (onEscapeWhileSearching?.()) event.preventDefault()
      return
    }
    if (handleSearchShortcutEvent(event, onToggleSearchShortcut)) return
    if (items.length === 0) return
    if (handleNeighborhoodShortcutEvent({
      event,
      items,
      highlightedPathRef,
      cancelOpen,
      onEnterNeighborhood,
    })) return
    // Jump to the top/bottom of the list (Home/End, or Cmd/Ctrl+Up/Down) —
    // checked before the modifier-ignore guard so Cmd+Up/Down aren't swallowed.
    const jumpEdge = resolveJumpEdge(event)
    if (jumpEdge) {
      event.preventDefault()
      jumpToEdge(jumpEdge)
      return
    }
    // Cmd+Shift+Up/Down jump a year back/forward — same early position as jumpEdge above.
    const jumpYearDirection = resolveJumpYearDirection(event)
    if (jumpYearDirection) {
      event.preventDefault()
      jumpByYear(jumpYearDirection)
      trackEvent('note_list_year_jump', { direction: jumpYearDirection, via: 'keyboard' })
      return
    }
    if (shouldIgnoreListKeyboardEvent(event)) return
    if (handleArrowNavigation(event, moveHighlight)) return

    const pendingPath = event.key === 'Enter' ? highlightedPathRef.current : null
    handleEnterShortcutEvent(event, items, highlightedPathRef, flushOpen)
    if (pendingPath) onFocusEditorOnEnter?.(pendingPath)
  }, [cancelOpen, enabled, flushOpen, highlightedPathRef, items, jumpByYear, jumpToEdge, moveHighlight, onEnterNeighborhood, onEscapeWhileSearching, onFocusEditorOnEnter, onToggleSearchShortcut])
}

function useFocusHandlers({
  containerRef,
  syncToCurrentSelection,
  syncHighlightedPath,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  syncToCurrentSelection: () => void
  syncHighlightedPath: (nextPath: string | null) => void
}) {
  const handleFocus = useCallback(() => {
    syncToCurrentSelection()
  }, [syncToCurrentSelection])

  const handleBlur = useCallback(() => {
    syncHighlightedPath(null)
  }, [syncHighlightedPath])

  const focusList = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    container.focus()
    requestAnimationFrame(() => {
      if (isListActive(containerRef.current)) syncToCurrentSelection()
    })
  }, [containerRef, syncToCurrentSelection])

  return { focusList, handleBlur, handleFocus }
}

function usePanelFocusState(panelRef: React.RefObject<HTMLDivElement | null>) {
  const [isPanelActiveState, setIsPanelActiveState] = useState(false)

  const syncPanelState = useCallback(() => {
    setIsPanelActiveState(isPanelActive(panelRef.current))
  }, [panelRef])

  const handlePanelFocusCapture = useCallback(() => {
    setIsPanelActiveState(true)
  }, [])

  const handlePanelBlurCapture = useCallback(() => {
    requestAnimationFrame(syncPanelState)
  }, [syncPanelState])

  return {
    handlePanelBlurCapture,
    handlePanelFocusCapture,
    isPanelActive: isPanelActiveState,
  }
}

function useGlobalKeyboardHandling({
  enabled,
  panelRef,
  containerRef,
  processKeyDown,
}: {
  enabled: boolean
  panelRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  processKeyDown: (event: KeyboardEvent) => void
}) {
  const shouldSkipGlobalKeyDown = useCallback((activeElement: Element | null) => {
    if (isEditableElement(activeElement)) return true
    return Boolean(
      activeElement !== containerRef.current
      && containerRef.current?.contains(activeElement)
      && isInteractiveElement(activeElement)
    )
  }, [containerRef])

  useEffect(() => {
    if (!enabled) return
    const handleWindowKeyDown = createGlobalKeyDownHandler(panelRef, containerRef, shouldSkipGlobalKeyDown, processKeyDown)

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [containerRef, enabled, panelRef, processKeyDown, shouldSkipGlobalKeyDown])
}

function useSearchToggleShortcut({
  toggleSearch,
  searchVisible,
  focusList,
}: {
  toggleSearch?: () => void
  searchVisible: boolean
  focusList: () => void
}) {
  return useCallback(() => {
    if (!toggleSearch) return

    toggleSearch()
    if (!searchVisible) return

    requestAnimationFrame(() => {
      focusList()
    })
  }, [focusList, searchVisible, toggleSearch])
}

function useDirectKeyDownHandler(
  processKeyDown: (event: React.KeyboardEvent) => void,
) {
  return useCallback((event: React.KeyboardEvent) => {
    if (isNestedInteractiveTarget(event.target, event.currentTarget)) return
    processKeyDown(event)
  }, [processKeyDown])
}

function resolveStableHighlightedPath(items: VaultEntry[], highlightedPathState: string | null): string | null {
  return getItemIndex(items).entryByPath.has(highlightedPathState ?? '')
    ? highlightedPathState
    : null
}

function handleSearchShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'preventDefault'>,
  onToggleSearchShortcut?: () => void,
): boolean {
  if (!isToggleSearchShortcut(event) || !onToggleSearchShortcut) return false
  event.preventDefault()
  onToggleSearchShortcut()
  return true
}

function handleNeighborhoodShortcutEvent(options: {
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'>
  items: VaultEntry[]
  highlightedPathRef: React.RefObject<string | null>
  cancelOpen: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void | Promise<void>
}): boolean {
  const {
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  } = options

  if (!isNeighborhoodKey(event)) return false
  handleNeighborhoodActivation({
    event,
    items,
    highlightedPathRef,
    cancelOpen,
    onEnterNeighborhood,
  })
  return true
}

function shouldIgnoreListKeyboardEvent(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>,
): boolean {
  return usesCommandModifier(event) || event.altKey
}

function handleEnterShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
  items: VaultEntry[],
  highlightedPathRef: React.RefObject<string | null>,
  flushOpen: (entry?: VaultEntry) => void,
) {
  if (event.key !== 'Enter') return
  handleHighlightedOpen({
    event,
    items,
    highlightedPathRef,
    flushOpen,
  })
}

/** Keys that drive the note list itself (highlight movement / jumps). */
function isListNavigationKey(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'ArrowUp'
    || event.key === 'ArrowDown'
    || event.key === 'Home'
    || event.key === 'End'
}

/**
 * When the list handles a navigation key while DOM focus sits on `<body>` (e.g.
 * right after startup, before anything has been clicked), pull focus into the
 * container. Arrows are clearly driving the list at that point, so the
 * active-pane indicator should turn on. Runs only while focus is outside the
 * container — once focused, the container's own keydown handler takes over.
 */
function claimNoteListFocusForNavigation(
  event: Pick<KeyboardEvent, 'key'>,
  container: HTMLDivElement | null,
): void {
  if (!isListNavigationKey(event) || !container) return
  const active = document.activeElement
  if (active === container || container.contains(active)) return
  container.focus()
}

function createGlobalKeyDownHandler(
  panelRef: React.RefObject<HTMLDivElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  shouldSkipGlobalKeyDown: (activeElement: Element | null) => boolean,
  processKeyDown: (event: KeyboardEvent) => void,
) {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (isToggleSearchShortcut(event) && isPanelActive(panelRef.current)) {
      processKeyDown(event)
      return
    }
    if (shouldSkipGlobalKeyDown(document.activeElement)) return
    processKeyDown(event)
    claimNoteListFocusForNavigation(event, containerRef.current)
  }
}

export function useNoteListKeyboard({
  items,
  selectedNotePath,
  onOpen,
  onEnterNeighborhood,
  onPrefetch,
  searchVisible = false,
  toggleSearch,
  enabled,
  onFocusEditorOnEnter,
  onExitTop,
  jumpDateField,
  jumpDateListDirection,
}: NoteListKeyboardOptions) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { itemsRef, selectedNotePathRef } = useKeyboardItemRefs(items, selectedNotePath)
  const { highlightedPathRef, highlightedPathState, syncHighlightedPath } = useHighlightedPath()
  const syncToCurrentSelection = useSelectionSync(itemsRef, selectedNotePathRef, syncHighlightedPath)
  const { cancelOpen, flushOpen, scheduleOpen } = useScheduledOpen(onOpen, enabled)
  const { focusList, handleBlur, handleFocus } = useFocusHandlers({
    containerRef,
    syncToCurrentSelection,
    syncHighlightedPath,
  })
  const { handlePanelBlurCapture, handlePanelFocusCapture, isPanelActive: isPanelActiveState } = usePanelFocusState(panelRef)
  const handleToggleSearchShortcut = useSearchToggleShortcut({
    focusList,
    searchVisible,
    toggleSearch,
  })
  const moveHighlight = useMoveHighlight({
    items,
    selectedNotePath,
    highlightedPathRef,
    syncHighlightedPath,
    virtuosoRef,
    onPrefetch,
    scheduleOpen,
    onExitTop,
  })
  const jumpToEdge = useJumpToEdge({
    items,
    syncHighlightedPath,
    virtuosoRef,
    onPrefetch,
    scheduleOpen,
  })
  const jumpToDate = useJumpToDate({
    items,
    syncHighlightedPath,
    virtuosoRef,
    onPrefetch,
    scheduleOpen,
  })
  const jumpByYear = useJumpByYear({
    items,
    selectedNotePath,
    highlightedPathRef,
    jumpDateField,
    jumpDateListDirection,
    jumpToDate,
  })
  const handleEscapeWhileSearching = useCallback(() => {
    if (!searchVisible || !toggleSearch) return false
    // Mirror the search box's own Escape: clear the query, hide the bar, and
    // keep keyboard focus on the now-unfiltered list.
    toggleSearch()
    focusList()
    return true
  }, [focusList, searchVisible, toggleSearch])
  const processKeyDown = useProcessKeyDown({
    enabled,
    items,
    highlightedPathRef,
    moveHighlight,
    jumpToEdge,
    jumpByYear,
    flushOpen,
    cancelOpen,
    onEnterNeighborhood,
    onToggleSearchShortcut: handleToggleSearchShortcut,
    onEscapeWhileSearching: handleEscapeWhileSearching,
    onFocusEditorOnEnter,
  })
  const handleKeyDown = useDirectKeyDownHandler(processKeyDown)
  useGlobalKeyboardHandling({ enabled, panelRef, containerRef, processKeyDown })
  const lastSyncedSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    cancelOpen()
    if (selectedNotePath === lastSyncedSelectionRef.current) return
    lastSyncedSelectionRef.current = selectedNotePath
    // When the active note changes (e.g. opened from search, quick-open, or a
    // wikilink), move the keyboard highlight to it so arrow keys continue from
    // there — as if it had been clicked in the list. During arrow navigation
    // the highlight already leads and the selection only catches up to it, so
    // this is a no-op for keyboard moves.
    if (selectedNotePath && getItemIndex(itemsRef.current).entryByPath.has(selectedNotePath)) {
      syncHighlightedPath(selectedNotePath)
    }
  }, [cancelOpen, itemsRef, selectedNotePath, syncHighlightedPath])

  const highlightedPath = resolveStableHighlightedPath(items, highlightedPathState)

  return {
    containerRef,
    focusList,
    handlePanelBlurCapture,
    handlePanelFocusCapture,
    highlightedPath,
    handleBlur,
    handleKeyDown,
    handleFocus,
    isPanelActive: isPanelActiveState,
    panelRef,
    toggleSearchShortcut: handleToggleSearchShortcut,
    virtuosoRef,
    jumpToDate,
    jumpByYear,
    canJumpByYear: jumpDateField !== undefined,
  }
}
