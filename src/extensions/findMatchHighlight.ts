import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'

export interface FindMatchRange {
  from: number
  to: number
}

/**
 * Marks the active find match so it is highlighted as a word, independent of
 * the text selection. The native selection only paints while the editor is
 * focused, so navigating matches from the find input would otherwise show
 * nothing but the active-line background.
 */
export const setFindMatchHighlight = StateEffect.define<FindMatchRange | null>()

const findMatchMark = Decoration.mark({ class: 'cm-find-active-match' })

export const findMatchHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let next = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setFindMatchHighlight)) continue
      const range = effect.value
      next = range && range.to > range.from
        ? Decoration.set([findMatchMark.range(range.from, range.to)])
        : Decoration.none
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export function findMatchHighlightTheme() {
  return EditorView.baseTheme({
    '.cm-find-active-match': {
      backgroundColor: 'var(--editor-find-match-bg)',
      borderRadius: '2px',
    },
  })
}
