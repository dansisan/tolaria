import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const TAG_LINE_START = /^#[a-zA-Z]/
const TAG_IN_LINE = /#([a-zA-Z][a-zA-Z0-9_\-/]*)/g

const inlineTagsPluginKey = new PluginKey('inlineTags')

const CODE_NODE_TYPES = new Set(['codeBlock', 'bn-code-block'])

function buildDecorations(doc: Parameters<typeof DecorationSet.create>[0]): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (CODE_NODE_TYPES.has(node.type.name)) return false
    // Container blocks (blockGroup, blockContainer): descend without decorating
    if (!node.inlineContent) return

    // Only decorate tag lines: inline content blocks whose text starts with #letter
    if (!TAG_LINE_START.test(node.textContent)) return false

    node.forEach((child, offset) => {
      if (!child.isText || !child.text) return
      if (child.marks.some((mark) => mark.type.name === 'code')) return

      TAG_IN_LINE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = TAG_IN_LINE.exec(child.text)) !== null) {
        const from = pos + 1 + offset + match.index
        const to = from + match[0].length
        decorations.push(Decoration.inline(from, to, { class: 'inline-tag' }))
      }
    })

    return false
  })

  return DecorationSet.create(doc, decorations)
}

const inlineTagsPlugin = new Plugin({
  key: inlineTagsPluginKey,
  state: {
    init(_, { doc }) {
      return buildDecorations(doc)
    },
    apply(tr, old) {
      return tr.docChanged ? buildDecorations(tr.doc) : old
    },
  },
  props: {
    decorations(state) {
      return inlineTagsPluginKey.getState(state) as DecorationSet
    },
  },
})

export const createInlineTagsExtension = createExtension({
  key: 'inlineTags',
  prosemirrorPlugins: [inlineTagsPlugin],
})
