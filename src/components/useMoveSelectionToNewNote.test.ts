import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMoveSelectionToNewNote } from './useMoveSelectionToNewNote'
import {
  MOVE_SELECTION_AVAILABILITY_EVENT,
  dispatchMoveSelectionToNewNote,
  readMoveSelectionAvailability,
} from '../utils/moveSelectionEvents'

vi.mock('../utils/editorDurableMarkdown', () => ({
  serializeDurableEditorBlocks: (_e: unknown, blocks: Array<{ text: string }>) => blocks.map((b) => b.text).join('\n'),
}))

function makeEditor(selectedText: string, { isEditable = true, dom = document.createElement('div') } = {}) {
  let listener: (() => void) | null = null
  const selection = { empty: selectedText === '' }
  const editor = {
    isEditable,
    domElement: dom,
    prosemirrorState: { selection },
    focus: vi.fn(),
    onSelectionChange: (cb: () => void) => { listener = cb; return () => { listener = null } },
    getSelectedText: () => selectedText,
    getSelection: () => ({ blocks: [{ id: 'a', text: selectedText }] }),
    getSelectionCutBlocks: () => ({ blocks: [{ id: 'a', text: selectedText }] }),
  }
  return {
    editor: editor as never,
    select(next: string) {
      selection.empty = next === ''
      listener?.()
    },
  }
}

function requestFromMenu() {
  act(() => { dispatchMoveSelectionToNewNote() })
}

function trackAvailability() {
  const values: boolean[] = []
  const handler = (event: Event) => {
    const value = readMoveSelectionAvailability(event)
    if (value !== null) values.push(value)
  }
  window.addEventListener(MOVE_SELECTION_AVAILABILITY_EVENT, handler)
  return { values, stop: () => window.removeEventListener(MOVE_SELECTION_AVAILABILITY_EVENT, handler) }
}

describe('move-to-new-note menu request', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('opens the dialog when text is selected', () => {
    const { result } = renderHook(() => useMoveSelectionToNewNote({ editor: makeEditor('aside').editor, locale: 'en' }))
    requestFromMenu()
    expect(result.current.dialogProps.open).toBe(true)
  })

  it('does nothing without a selection', () => {
    const { result } = renderHook(() => useMoveSelectionToNewNote({ editor: makeEditor('').editor, locale: 'en' }))
    requestFromMenu()
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('does nothing when the note is read-only', () => {
    const { result } = renderHook(() => useMoveSelectionToNewNote({ editor: makeEditor('aside', { isEditable: false }).editor, locale: 'en' }))
    requestFromMenu()
    expect(result.current.dialogProps.open).toBe(false)
  })
})

describe('move-to-new-note menu availability', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setup(selected: string, focusInEditor: boolean) {
    const dom = document.createElement('div')
    const inside = document.createElement('div')
    inside.tabIndex = 0
    const outside = document.createElement('input')
    dom.appendChild(inside)
    document.body.append(dom, outside)
    ;(focusInEditor ? inside : outside).focus()
    const tracker = trackAvailability()
    const harness = makeEditor(selected, { dom })
    const hook = renderHook(() => useMoveSelectionToNewNote({ editor: harness.editor, locale: 'en' }))
    return { ...tracker, ...harness, hook, inside, outside }
  }

  it('enables the menu item only with a selection while focus is in the editor', () => {
    const t = setup('', true)
    expect(t.values.at(-1)).toBe(false)
    act(() => t.select('aside'))
    expect(t.values.at(-1)).toBe(true)
    act(() => t.select(''))
    expect(t.values.at(-1)).toBe(false)
    t.stop()
  })

  it('stays disabled when focus is outside the editor so the key types normally', () => {
    const t = setup('aside', false)
    expect(t.values.at(-1)).toBe(false)
    t.stop()
  })

  it('follows focus moving out of and back into the editor', () => {
    const t = setup('aside', true)
    expect(t.values.at(-1)).toBe(true)
    act(() => t.outside.focus())
    expect(t.values.at(-1)).toBe(false)
    act(() => t.inside.focus())
    expect(t.values.at(-1)).toBe(true)
    t.stop()
  })

  it('disables the menu item on unmount', () => {
    const t = setup('aside', true)
    t.hook.unmount()
    expect(t.values.at(-1)).toBe(false)
    t.stop()
  })
})

describe('move-to-new-note ⌥M shortcut', () => {
  afterEach(() => { document.body.innerHTML = '' })

  function setup(selected: string, focusInEditor: boolean) {
    const dom = document.createElement('div')
    const inside = document.createElement('div')
    inside.tabIndex = 0
    const outside = document.createElement('input')
    dom.appendChild(inside)
    document.body.append(dom, outside)
    ;(focusInEditor ? inside : outside).focus()
    const harness = makeEditor(selected, { dom })
    const hook = renderHook(() => useMoveSelectionToNewNote({ editor: harness.editor, locale: 'en' }))
    return hook
  }

  function pressOptionM(init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { code: 'KeyM', key: 'µ', altKey: true, cancelable: true, bubbles: true, ...init })
    act(() => { window.dispatchEvent(event) })
    return event
  }

  it('opens the dialog and swallows the µ when text is selected in the editor', () => {
    const { result } = setup('aside', true)
    expect(pressOptionM().defaultPrevented).toBe(true)
    expect(result.current.dialogProps.open).toBe(true)
  })

  it('lets ⌥M through with no selection so µ still types', () => {
    const { result } = setup('', true)
    expect(pressOptionM().defaultPrevented).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('lets ⌥M through when focus is outside the editor', () => {
    const { result } = setup('aside', false)
    expect(pressOptionM().defaultPrevented).toBe(false)
    expect(result.current.dialogProps.open).toBe(false)
  })

  it('ignores other modifier combinations', () => {
    const { result } = setup('aside', true)
    pressOptionM({ metaKey: true })
    pressOptionM({ shiftKey: true })
    expect(result.current.dialogProps.open).toBe(false)
  })
})
