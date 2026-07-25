import type { Node as ProseMirrorNode } from 'prosemirror-model'

/**
 * Counts of the things a document install has to build, for attributing a slow
 * `view.updateState()`.
 *
 * ProseMirror creates a view descriptor — and for widget decorations, a DOM node —
 * per item here, so these counts are what `viewUpdate` time is actually spent on.
 * `codeLines` matters disproportionately: the code-block line-number extension adds
 * one widget decoration per line, built lazily during the view update, so a note
 * that is mostly code costs far more to install than its block count suggests.
 */
export interface EditorDocShape {
  nodes: number
  blocks: number
  codeBlocks: number
  codeLines: number
  textChars: number
  /** Wikilink inline nodes. Each is a React component whose render resolves the
   * target against the vault, so this count drives view-build cost directly. */
  wikilinks: number
  /** Every node type present, by count. ProseMirror builds a view descriptor per
   * node, so this is the direct breakdown of what a slow install spent its time on
   * — and it removes the need to guess which node type dominates. */
  nodeTypes: Record<string, number>
}

function emptyShape(): EditorDocShape {
  return {
    nodes: 0,
    blocks: 0,
    codeBlocks: 0,
    codeLines: 0,
    textChars: 0,
    wikilinks: 0,
    nodeTypes: {},
  }
}

function countLines(text: string): number {
  if (!text) return 0
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lines += 1
  }
  return lines
}

/** Walks the document once. O(nodes), so callers must gate this on diagnostics. */
export function describeEditorDocShape(doc: ProseMirrorNode | null | undefined): EditorDocShape {
  if (!doc) return emptyShape()

  const shape = emptyShape()
  doc.descendants((node) => {
    shape.nodes += 1
    shape.nodeTypes[node.type.name] = (shape.nodeTypes[node.type.name] ?? 0) + 1
    if (node.isText) shape.textChars += node.text?.length ?? 0
    if (node.type.name === 'wikilink') shape.wikilinks += 1
    if (node.inlineContent) shape.blocks += 1
    if (node.type.name !== 'codeBlock') return true

    shape.codeBlocks += 1
    shape.codeLines += countLines(node.textContent)
    return false
  })
  return shape
}

/** The node types that cost the most to build, biggest first. */
export function formatNodeTypeHistogram(nodeTypes: Record<string, number>, limit = 8): string {
  const ranked = Object.entries(nodeTypes)
    .sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))
    .slice(0, limit)
    .map(([name, count]) => `${name}:${count}`)
  return ranked.length === 0 ? 'types=none' : `types=${ranked.join(',')}`
}

export function formatEditorDocShape(shape: EditorDocShape): string {
  return `nodes=${shape.nodes} textBlocks=${shape.blocks} wikilinks=${shape.wikilinks} `
    + `codeBlocks=${shape.codeBlocks} codeLines=${shape.codeLines} textChars=${shape.textChars} `
    + formatNodeTypeHistogram(shape.nodeTypes)
}
