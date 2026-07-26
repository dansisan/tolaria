import { TextSelection } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'

interface SelectionTransaction {
  doc?: ProseMirrorNode
  setSelection: (selection: TextSelection) => unknown
}

type TiptapEditorBridge = {
  state?: {
    doc?: { content?: { size?: unknown } }
  }
  commands?: {
    setTextSelection?: (position: number) => unknown
  }
}

function getTiptapEditorBridge(editor: unknown): TiptapEditorBridge | null {
  const editorWithBridge = editor as { _tiptapEditor?: TiptapEditorBridge }
  return editorWithBridge._tiptapEditor ?? null
}

function getSafeTextSelectionPosition(tiptapEditor: TiptapEditorBridge): number {
  const size = tiptapEditor.state?.doc?.content?.size
  if (typeof size !== 'number' || !Number.isFinite(size)) return 0
  return size > 0 ? Math.min(1, size) : 0
}

/**
 * Moves a transaction's selection to the top of the document it produces.
 *
 * Preferred over `resetTextSelectionBeforeContentSwap` whenever the caller already has
 * a transaction that replaces the content: setting it here rides along with that
 * transaction, whereas the command dispatches its own. On a large outgoing note the
 * extra dispatch cost a full view update — 80-100ms — for a caret move.
 */
export function resetSelectionWithinTransaction(transaction: SelectionTransaction): void {
  try {
    const doc = transaction.doc
    if (!doc) return
    transaction.setSelection(TextSelection.create(doc, Math.min(1, doc.content.size)))
  } catch (err) {
    console.warn('Failed to reset editor selection within the swap transaction:', err)
  }
}

/**
 * Dispatches its own transaction to reset the selection. Only for callers replacing
 * content by a route that has no transaction to attach to, such as `setContent`.
 */
export function resetTextSelectionBeforeContentSwap(editor: unknown): void {
  const tiptapEditor = getTiptapEditorBridge(editor)
  const setTextSelection = tiptapEditor?.commands?.setTextSelection
  if (!tiptapEditor || typeof setTextSelection !== 'function') return

  try {
    setTextSelection(getSafeTextSelectionPosition(tiptapEditor))
  } catch (err) {
    console.warn('Failed to reset editor selection before content swap:', err)
  }
}
