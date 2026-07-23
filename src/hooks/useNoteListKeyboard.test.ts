import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useNoteListKeyboard } from './useNoteListKeyboard'
import { trackEvent } from '../lib/telemetry'
import type { VaultEntry } from '../types'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))

function makeEntry(path: string, title: string, overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path,
    title,
    filename: `${title}.md`,
    isA: 'Note',
    aliases: [],
    tags: [],
    snippet: '',
    status: null,
    favorite: false,
    archived: false,
    createdAt: null,
    modifiedAt: null,
    fileSize: 100,
    color: null,
    icon: null,
    template: null, sort: null,
    outgoingLinks: [],
    relationships: {},
    ...overrides,
  }
}

/** Unix seconds for a local calendar date, matching how VaultEntry.createdAt/modifiedAt are stored. */
function dateSecs(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}

function keyEvent(key: string, opts: Partial<React.KeyboardEvent> = {}): React.KeyboardEvent {
  return { key, preventDefault: vi.fn(), metaKey: false, ctrlKey: false, altKey: false, ...opts } as unknown as React.KeyboardEvent
}

function installAnimationFrameStub() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id)
  })

  return {
    flushAnimationFrame: () => {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of pending) callback(0)
    },
  }
}

describe('useNoteListKeyboard', () => {
  const items = [makeEntry('/a.md', 'A'), makeEntry('/b.md', 'B'), makeEntry('/c.md', 'C')]
  const onOpen = vi.fn()
  let flushAnimationFrame: () => void

  beforeEach(() => {
    vi.clearAllMocks()
    ;({ flushAnimationFrame } = installAnimationFrameStub())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes with no highlight', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    expect(result.current.highlightedPath).toBeNull()
  })

  it('ArrowDown highlights first item from no selection', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBe('/a.md')
    expect(open).not.toHaveBeenCalled()
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledWith(items[0])
  })

  it('ArrowDown advances highlight and opens the latest highlighted note on the next frame', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBe('/b.md')
    expect(open).not.toHaveBeenCalled()
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(items[1])
  })

  it('ArrowDown clamps at end of list', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBe('/c.md')
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(items[2])
  })

  it('ArrowUp highlights last item from no selection', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(result.current.highlightedPath).toBe('/c.md')
    expect(open).not.toHaveBeenCalled()
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledWith(items[2])
  })

  it('scrolls the highlighted item into view with nearest-style behavior', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    const scrollIntoView = vi.fn()
    result.current.virtuosoRef.current = { scrollIntoView } as never

    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))

    expect(scrollIntoView).toHaveBeenCalledWith({ index: 0, behavior: 'auto' })
  })

  it('Home jumps to the top of the list and scrolls there', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/c.md', onOpen: open, enabled: true }),
    )
    const scrollToIndex = vi.fn()
    result.current.virtuosoRef.current = { scrollToIndex } as never

    act(() => result.current.handleKeyDown(keyEvent('Home')))

    expect(result.current.highlightedPath).toBe('/a.md')
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, align: 'start', behavior: 'auto' })
  })

  it('Cmd+Up also jumps to the top of the list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/c.md', onOpen, enabled: true }),
    )
    result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

    act(() => result.current.handleKeyDown(keyEvent('ArrowUp', { metaKey: true } as Partial<React.KeyboardEvent>)))

    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('End jumps to the bottom of the list and scrolls there', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/a.md', onOpen, enabled: true }),
    )
    const scrollToIndex = vi.fn()
    result.current.virtuosoRef.current = { scrollToIndex } as never

    act(() => result.current.handleKeyDown(keyEvent('End')))

    expect(result.current.highlightedPath).toBe('/c.md')
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'end', behavior: 'auto' })
  })

  it('Cmd+Down also jumps to the bottom of the list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/a.md', onOpen, enabled: true }),
    )
    result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

    act(() => result.current.handleKeyDown(keyEvent('ArrowDown', { metaKey: true } as Partial<React.KeyboardEvent>)))

    expect(result.current.highlightedPath).toBe('/c.md')
  })

  it('ArrowUp clamps at start of list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('ArrowUp at the top of the list calls onExitTop', () => {
    const onExitTop = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true, onExitTop }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(onExitTop).toHaveBeenCalledTimes(1)
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('ArrowUp below the top of the list moves the highlight without calling onExitTop', () => {
    const onExitTop = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true, onExitTop }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(onExitTop).not.toHaveBeenCalled()
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('ArrowUp with no highlight still wraps to the last item instead of calling onExitTop', () => {
    const onExitTop = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true, onExitTop }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(onExitTop).not.toHaveBeenCalled()
    expect(result.current.highlightedPath).toBe('/c.md')
  })

  it('Enter opens highlighted note', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('Enter')))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(items[0])
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('Enter does nothing when no item highlighted', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('Enter')))
    expect(open).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: false }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBeNull()
  })

  it('moves the highlight to an externally selected note so arrows continue from it', () => {
    const { result, rerender } = renderHook(
      ({ sel }: { sel: string | null }) =>
        useNoteListKeyboard({ items, selectedNotePath: sel, onOpen, enabled: true }),
      { initialProps: { sel: '/a.md' as string | null } },
    )

    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBe('/b.md')

    // Note opened from outside the list (e.g. via search) jumps the highlight there.
    rerender({ sel: '/c.md' })
    expect(result.current.highlightedPath).toBe('/c.md')

    // Arrow now continues from the selected note, not the stale highlight.
    act(() => result.current.handleKeyDown(keyEvent('ArrowUp')))
    expect(result.current.highlightedPath).toBe('/b.md')
  })

  it('does nothing for arrow keys with a non-jump modifier (Alt)', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown', { altKey: true } as Partial<React.KeyboardEvent>)))
    expect(result.current.highlightedPath).toBeNull()
  })

  it('resets highlight when items change', () => {
    const { result, rerender } = renderHook(
      ({ items: hookItems }) => useNoteListKeyboard({ items: hookItems, selectedNotePath: null, onOpen, enabled: true }),
      { initialProps: { items } },
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBe('/a.md')

    rerender({ items: [makeEntry('/d.md', 'D')] })
    expect(result.current.highlightedPath).toBeNull()
  })

  it('handleFocus sets highlight to selected note', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: '/b.md', onOpen, enabled: true }),
    )
    act(() => result.current.handleFocus())
    expect(result.current.highlightedPath).toBe('/b.md')
  })

  it('handleFocus defaults to first item when no selected note', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleFocus())
    expect(result.current.highlightedPath).toBe('/a.md')
  })

  it('does nothing on empty item list', () => {
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items: [], selectedNotePath: null, onOpen, enabled: true }),
    )
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    expect(result.current.highlightedPath).toBeNull()
  })

  it('responds to global arrow keys when no editable element is focused', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    expect(result.current.highlightedPath).toBe('/a.md')
    act(() => flushAnimationFrame())
    expect(open).toHaveBeenCalledWith(items[0])
  })

  it('ignores global arrow keys while an editable element is focused', () => {
    const open = vi.fn()
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    document.body.appendChild(editor)
    editor.focus()

    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    expect(result.current.highlightedPath).toBeNull()
    expect(open).not.toHaveBeenCalled()

    editor.remove()
  })

  it('coalesces rapid arrow navigation into a single open for the latest highlighted note', () => {
    const open = vi.fn()
    const { result } = renderHook(() =>
      useNoteListKeyboard({ items, selectedNotePath: null, onOpen: open, enabled: true }),
    )

    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))
    act(() => result.current.handleKeyDown(keyEvent('ArrowDown')))

    expect(result.current.highlightedPath).toBe('/c.md')
    expect(open).not.toHaveBeenCalled()

    act(() => flushAnimationFrame())

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(items[2])
  })

  describe('jumpByYear', () => {
    const dated = [
      makeEntry('/2022.md', '2022', { createdAt: dateSecs(2022, 6, 15), modifiedAt: dateSecs(2022, 6, 15) }),
      makeEntry('/2023.md', '2023', { createdAt: dateSecs(2023, 6, 15), modifiedAt: dateSecs(2023, 6, 15) }),
      makeEntry('/2024-leap.md', '2024', { createdAt: dateSecs(2024, 2, 29), modifiedAt: dateSecs(2024, 2, 29) }),
    ]

    // 'up'/'down' are always physical (which way through the currently displayed list),
    // matching plain arrow navigation — direction defaults to 'desc' (newest first) when
    // jumpDateListDirection is omitted.

    it('sorted desc (newest first): down goes back a year (older)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2023.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'desc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('down'))

      expect(result.current.highlightedPath).toBe('/2022.md')
    })

    it('sorted desc (newest first): up goes forward a year (newer)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2022.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'desc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('up'))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('sorted asc (oldest first): down goes forward a year (newer) — the flip', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2022.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'asc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('down'))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('sorted asc (oldest first): up goes back a year (older) — the flip', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2023.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'asc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('up'))

      expect(result.current.highlightedPath).toBe('/2022.md')
    })

    it('handles a leap-day anchor without throwing, landing on the nearest available note', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2024-leap.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'desc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('down'))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('does nothing when jumpDateField is not provided (list not sorted by a date field)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({ items: dated, selectedNotePath: '/2023.md', onOpen, enabled: true }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('down'))

      // Unchanged from the initial selection-sync — jumpByYear itself no-ops.
      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('does nothing when the current note has no value for the configured date field', () => {
      const undated = makeEntry('/none.md', 'None')
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: [undated, ...dated],
          selectedNotePath: '/none.md',
          onOpen,
          enabled: true,
          jumpDateField: 'createdAt',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpByYear('down'))

      expect(result.current.highlightedPath).toBe('/none.md')
    })

    it('exposes canJumpByYear based on whether a date field is configured', () => {
      const withField = renderHook(() =>
        useNoteListKeyboard({ items: dated, selectedNotePath: null, onOpen, enabled: true, jumpDateField: 'modifiedAt' }),
      )
      expect(withField.result.current.canJumpByYear).toBe(true)

      const withoutField = renderHook(() =>
        useNoteListKeyboard({ items: dated, selectedNotePath: null, onOpen, enabled: true }),
      )
      expect(withoutField.result.current.canJumpByYear).toBe(false)
    })

    it('Cmd+Shift+ArrowDown sorted desc jumps back a year (older)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2023.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'desc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.handleKeyDown(keyEvent('ArrowDown', { metaKey: true, shiftKey: true } as Partial<React.KeyboardEvent>)))

      expect(result.current.highlightedPath).toBe('/2022.md')
      expect(trackEvent).toHaveBeenCalledWith('note_list_year_jump', { direction: 'down', via: 'keyboard' })
    })

    it('Cmd+Shift+ArrowUp sorted desc jumps forward a year (newer)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2022.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'desc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.handleKeyDown(keyEvent('ArrowUp', { metaKey: true, shiftKey: true } as Partial<React.KeyboardEvent>)))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('Cmd+Shift+ArrowDown sorted asc jumps forward a year (newer) — the flip via keyboard', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({
          items: dated, selectedNotePath: '/2022.md', onOpen, enabled: true,
          jumpDateField: 'createdAt', jumpDateListDirection: 'asc',
        }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.handleKeyDown(keyEvent('ArrowDown', { metaKey: true, shiftKey: true } as Partial<React.KeyboardEvent>)))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('Cmd+Up without Shift still jumps to the top of the list (regression)', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({ items: dated, selectedNotePath: '/2023.md', onOpen, enabled: true, jumpDateField: 'createdAt' }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.handleKeyDown(keyEvent('ArrowUp', { metaKey: true } as Partial<React.KeyboardEvent>)))

      expect(result.current.highlightedPath).toBe('/2022.md')
    })
  })

  describe('jumpToDate', () => {
    const dated = [
      makeEntry('/2022.md', '2022', { createdAt: dateSecs(2022, 6, 15) }),
      makeEntry('/2023.md', '2023', { createdAt: dateSecs(2023, 6, 15) }),
      makeEntry('/2024.md', '2024', { createdAt: dateSecs(2024, 6, 15) }),
    ]

    it('reveals the nearest entry to an explicit target date and field, regardless of jumpDateField', () => {
      const { result } = renderHook(() =>
        useNoteListKeyboard({ items: dated, selectedNotePath: null, onOpen, enabled: true }),
      )
      result.current.virtuosoRef.current = { scrollToIndex: vi.fn() } as never

      act(() => result.current.jumpToDate(dateSecs(2023, 7, 1) * 1000, 'createdAt'))

      expect(result.current.highlightedPath).toBe('/2023.md')
    })

    it('does nothing when no entry has the target date field', () => {
      const undatedOnly = [makeEntry('/a.md', 'A'), makeEntry('/b.md', 'B')]
      const { result } = renderHook(() =>
        useNoteListKeyboard({ items: undatedOnly, selectedNotePath: null, onOpen, enabled: true }),
      )

      act(() => result.current.jumpToDate(Date.now(), 'createdAt'))

      expect(result.current.highlightedPath).toBeNull()
    })
  })
})
