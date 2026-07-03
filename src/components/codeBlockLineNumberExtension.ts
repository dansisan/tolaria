import { createExtension } from '@blocknote/core'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const codeBlockLineNumberPluginKey = new PluginKey<DecorationSet>('codeBlockLineNumber')

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

function codeBlockLineDecorations(node: ProseMirrorNode, pos: number): Decoration[] {
  return codeBlockLineStarts(node.textContent, pos + 1).map(({ pos: linePos, line }) =>
    Decoration.widget(linePos, () => lineNumberElement(line), { side: -1, key: `code-line-${linePos}-${line}` }),
  )
}

/**
 * Widget decorations rendering a line number at the start of every code-block
 * line. Numbers live in a left gutter reserved by CSS and are hidden unless the
 * user opts in (`:root[data-code-line-numbers]`, see useCodeLineNumbers); the
 * decorations are always present so toggling the setting is pure CSS and needs
 * no editor transaction.
 */
export function buildCodeBlockLineNumberDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    decorations.push(...codeBlockLineDecorations(node, pos))
    return false
  })
  return DecorationSet.create(doc, decorations)
}

interface ChangedSpan {
  from: number
  to: number
}

/**
 * One span per step covering everything the step touched, in final-document
 * coordinates, padded by one position so node boundaries (splits, joins) fall
 * inside. Collapsing a step's ranges into a single span also covers the "gap"
 * of ReplaceAroundSteps (code block ↔ paragraph conversions), whose inner
 * content survives mapping but may need its decorations dropped.
 */
function transactionChangedSpans(tr: Transaction): ChangedSpan[] {
  const spans: ChangedSpan[] = []
  tr.mapping.maps.forEach((stepMap, index) => {
    let from = Infinity
    let to = -Infinity
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, newStart)
      to = Math.max(to, newEnd)
    })
    if (to < from) return

    const toFinalDoc = tr.mapping.slice(index + 1)
    spans.push({
      from: Math.max(0, toFinalDoc.map(from, -1) - 1),
      to: Math.min(tr.doc.content.size, toFinalDoc.map(to, 1) + 1),
    })
  })
  return spans
}

function codeBlocksIntersecting(doc: ProseMirrorNode, spans: ChangedSpan[]): Map<number, ProseMirrorNode> {
  const blocks = new Map<number, ProseMirrorNode>()
  for (const { from, to } of spans) {
    doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name !== 'codeBlock') return true
      blocks.set(pos, node)
      return false
    })
  }
  return blocks
}

/**
 * Incremental per-transaction update: map the previous set through the change
 * and rebuild only the code blocks the change touched. Untouched blocks keep
 * their widget instances, and the document is never re-scanned per keystroke —
 * rebuilding from scratch here made every transaction cost O(doc size).
 */
export function applyCodeBlockLineNumberDecorations(tr: Transaction, previous: DecorationSet): DecorationSet {
  if (!tr.docChanged) return previous

  const spans = transactionChangedSpans(tr)
  let next = previous.map(tr.mapping, tr.doc)
  for (const { from, to } of spans) {
    next = next.remove(next.find(from, to))
  }
  for (const [pos, node] of codeBlocksIntersecting(tr.doc, spans)) {
    next = next.remove(next.find(pos, pos + node.nodeSize))
    next = next.add(tr.doc, codeBlockLineDecorations(node, pos))
  }
  return next
}

const codeBlockLineNumberPlugin = new Plugin<DecorationSet>({
  key: codeBlockLineNumberPluginKey,
  state: {
    init: (_config, state) => buildCodeBlockLineNumberDecorations(state.doc),
    apply: (tr, previous) => applyCodeBlockLineNumberDecorations(tr, previous),
  },
  props: {
    decorations: (state) => codeBlockLineNumberPluginKey.getState(state),
  },
})

export const createCodeBlockLineNumberExtension = createExtension(() => ({
  key: 'codeBlockLineNumber',
  prosemirrorPlugins: [codeBlockLineNumberPlugin],
}))
