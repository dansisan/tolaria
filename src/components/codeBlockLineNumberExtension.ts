import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const codeBlockLineNumberPluginKey = new PluginKey('codeBlockLineNumber')

/** Class shared with EditorTheme.css and the copy-text filter (codeBlockText). */
export const CODE_LINE_NUMBER_CLASS = 'editor__code-line-number'

export interface CodeLineStart {
  pos: number
  line: number
}

/**
 * Document positions where each logical line of a code block begins, paired
 * with its 1-based line number. `contentStart` is the position of the first
 * character inside the code block (the node position + 1). Lines split on
 * "\n"; a trailing newline yields a final empty line, matching how editors
 * number a blank last row.
 */
export function codeBlockLineStarts(text: string, contentStart: number): CodeLineStart[] {
  const starts: CodeLineStart[] = [{ pos: contentStart, line: 1 }]
  let line = 1
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue
    line += 1
    starts.push({ pos: contentStart + index + 1, line })
  }
  return starts
}

function lineNumberElement(line: number): HTMLElement {
  const span = document.createElement('span')
  span.className = CODE_LINE_NUMBER_CLASS
  span.setAttribute('aria-hidden', 'true')
  span.contentEditable = 'false'
  span.textContent = String(line)
  return span
}

/**
 * Widget decorations rendering a line number at the start of every code-block
 * line. Numbers live in a left gutter reserved by CSS and are hidden unless the
 * user opts in (`:root[data-code-line-numbers]`, see useCodeLineNumbers); the
 * decorations are always present so toggling the setting is pure CSS and needs
 * no editor transaction. Decorations survive ProseMirror redraws — the Shiki
 * highlight plugin's own decorations compose with these.
 */
function codeBlockLineNumberDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const contentStart = pos + 1
    for (const { pos: linePos, line } of codeBlockLineStarts(node.textContent, contentStart)) {
      decorations.push(
        Decoration.widget(linePos, () => lineNumberElement(line), { side: -1, key: `code-line-${linePos}-${line}` }),
      )
    }
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}

const codeBlockLineNumberPlugin = new Plugin({
  key: codeBlockLineNumberPluginKey,
  props: {
    decorations: codeBlockLineNumberDecorations,
  },
})

export const createCodeBlockLineNumberExtension = createExtension(() => ({
  key: 'codeBlockLineNumber',
  prosemirrorPlugins: [codeBlockLineNumberPlugin],
}))
