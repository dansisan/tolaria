import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  findMatchHighlightField,
  findMatchHighlightTheme,
  setFindMatchHighlight,
} from './findMatchHighlight'

function createView(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    extensions: [findMatchHighlightField, findMatchHighlightTheme()],
  })
  const view = new EditorView({ state, parent })
  return { view, parent }
}

describe('findMatchHighlight', () => {
  it('marks only the matched range, not the whole line', () => {
    const { view, parent } = createView('the quick brown fox')

    view.dispatch({ effects: setFindMatchHighlight.of({ from: 4, to: 9 }) })

    const marks = parent.querySelectorAll('.cm-find-active-match')
    expect(marks.length).toBe(1)
    expect(marks[0]?.textContent).toBe('quick')

    view.destroy()
    parent.remove()
  })

  it('clears the highlight when set to null', () => {
    const { view, parent } = createView('the quick brown fox')

    view.dispatch({ effects: setFindMatchHighlight.of({ from: 4, to: 9 }) })
    view.dispatch({ effects: setFindMatchHighlight.of(null) })

    expect(parent.querySelectorAll('.cm-find-active-match').length).toBe(0)

    view.destroy()
    parent.remove()
  })

  it('ignores empty ranges', () => {
    const { view, parent } = createView('the quick brown fox')

    view.dispatch({ effects: setFindMatchHighlight.of({ from: 4, to: 4 }) })

    expect(parent.querySelectorAll('.cm-find-active-match').length).toBe(0)

    view.destroy()
    parent.remove()
  })

  it('maps the highlighted range across document edits', () => {
    const { view, parent } = createView('the quick brown fox')

    view.dispatch({ effects: setFindMatchHighlight.of({ from: 4, to: 9 }) })
    // Insert text before the match; the decoration should shift with it.
    view.dispatch({ changes: { from: 0, insert: 'oh ' } })

    const marks = parent.querySelectorAll('.cm-find-active-match')
    expect(marks.length).toBe(1)
    expect(marks[0]?.textContent).toBe('quick')

    view.destroy()
    parent.remove()
  })
})
