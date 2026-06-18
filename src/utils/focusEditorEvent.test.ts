import { describe, expect, it, vi, afterEach } from 'vitest'
import { FOCUS_EDITOR_EVENT, requestEditorFocus } from './focusEditorEvent'

describe('requestEditorFocus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dispatches the focus-editor event with the target note path', () => {
    const events: CustomEvent[] = []
    const listener = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener(FOCUS_EDITOR_EVENT, listener)

    requestEditorFocus('notes/idea.md')

    window.removeEventListener(FOCUS_EDITOR_EVENT, listener)
    expect(events).toHaveLength(1)
    expect(events[0].detail).toEqual({ path: 'notes/idea.md' })
  })

  it('defaults the path to null when none is provided', () => {
    const events: CustomEvent[] = []
    const listener = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener(FOCUS_EDITOR_EVENT, listener)

    requestEditorFocus()

    window.removeEventListener(FOCUS_EDITOR_EVENT, listener)
    expect(events[0].detail).toEqual({ path: null })
  })
})
