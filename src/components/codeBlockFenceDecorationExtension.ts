import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const codeBlockFenceDecorationPluginKey = new PluginKey('codeBlockFenceDecoration')

export interface FenceSelectionPosition {
  depth: number
  node: (depth: number) => { type: { name: string }; nodeSize: number }
  before: (depth: number) => number
}

/** The node range of the code block containing the selection head, or null. */
export function fenceDecorationRange($from: FenceSelectionPosition): { from: number; to: number } | null {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name !== 'codeBlock') continue

    const from = $from.before(depth)
    return { from, to: from + node.nodeSize }
  }

  return null
}

/**
 * Marks the code block containing the text cursor with a
 * `data-fence-line-active` attribute via a node decoration, so the editor CSS
 * can reserve room for the fence line overlay (see codeBlockChrome). A
 * decoration survives ProseMirror redraws — mutating the DOM directly from
 * outside would be reverted (and re-trigger renders).
 */
function fenceDecorations(state: EditorState): DecorationSet {
  const range = fenceDecorationRange(state.selection.$from)
  if (!range) return DecorationSet.empty

  return DecorationSet.create(state.doc, [
    Decoration.node(range.from, range.to, { 'data-fence-line-active': 'true' }),
  ])
}

const codeBlockFenceDecorationPlugin = new Plugin({
  key: codeBlockFenceDecorationPluginKey,
  props: {
    decorations: fenceDecorations,
  },
})

export const createCodeBlockFenceDecorationExtension = createExtension({
  key: 'codeBlockFenceDecoration',
  prosemirrorPlugins: [codeBlockFenceDecorationPlugin],
})
