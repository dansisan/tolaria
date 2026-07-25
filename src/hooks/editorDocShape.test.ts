import { describe, expect, it } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { describeEditorDocShape, formatEditorDocShape, formatNodeTypeHistogram } from './editorDocShape'

interface FakeNode {
  type: { name: string }
  isText?: boolean
  text?: string
  inlineContent?: boolean
  textContent?: string
  children?: FakeNode[]
}

/** Minimal stand-in for ProseMirror's descendants() walk, including the
 * "return false to skip children" contract the shape walker relies on. */
function fakeDoc(children: FakeNode[]): ProseMirrorNode {
  const walk = (nodes: FakeNode[], visit: (node: FakeNode) => boolean | void): void => {
    for (const node of nodes) {
      const descend = visit(node)
      if (descend === false) continue
      if (node.children) walk(node.children, visit)
    }
  }

  return {
    descendants: (visit: (node: FakeNode) => boolean | void) => walk(children, visit),
  } as unknown as ProseMirrorNode
}

const paragraph = (text: string): FakeNode => ({
  type: { name: 'paragraph' },
  inlineContent: true,
  textContent: text,
  children: [{ type: { name: 'text' }, isText: true, text }],
})

const codeBlock = (text: string): FakeNode => ({
  type: { name: 'codeBlock' },
  inlineContent: true,
  textContent: text,
  children: [{ type: { name: 'text' }, isText: true, text }],
})

describe('describeEditorDocShape', () => {
  it('returns an empty shape for a missing document', () => {
    expect(describeEditorDocShape(null)).toEqual({
      nodes: 0,
      blocks: 0,
      codeBlocks: 0,
      codeLines: 0,
      textChars: 0,
      wikilinks: 0,
      nodeTypes: {},
    })
  })

  it('counts text blocks and their characters', () => {
    const shape = describeEditorDocShape(fakeDoc([paragraph('hello'), paragraph('world!')]))

    expect(shape).toEqual({
      nodes: 4,
      blocks: 2,
      codeBlocks: 0,
      codeLines: 0,
      textChars: 11,
      wikilinks: 0,
      nodeTypes: { paragraph: 2, text: 2 },
    })
  })

  it('counts a line per newline in code blocks and does not descend into them', () => {
    const shape = describeEditorDocShape(fakeDoc([codeBlock('one\ntwo\nthree')]))

    // Children are skipped for code blocks, so the inner text node is not counted.
    expect(shape.nodes).toBe(1)
    expect(shape.codeBlocks).toBe(1)
    expect(shape.codeLines).toBe(3)
    expect(shape.textChars).toBe(0)
  })

  it('attributes a code-heavy document to codeLines', () => {
    const manyLines = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join('\n')
    const shape = describeEditorDocShape(fakeDoc([paragraph('intro'), codeBlock(manyLines)]))

    expect(shape.codeLines).toBe(3000)
    expect(formatEditorDocShape(shape)).toContain('codeLines=3000')
  })

  it('counts wikilink inline nodes, the expensive ones to build', () => {
    const wikilink = (): FakeNode => ({ type: { name: 'wikilink' } })
    const shape = describeEditorDocShape(fakeDoc([
      {
        type: { name: 'paragraph' },
        inlineContent: true,
        textContent: 'see also',
        children: [wikilink(), wikilink(), { type: { name: 'text' }, isText: true, text: 'ok' }],
      },
    ]))

    expect(shape.wikilinks).toBe(2)
  })

  it('ranks node types by count so the dominant one is obvious', () => {
    const histogram = formatNodeTypeHistogram({ paragraph: 25, hardBreak: 8795, text: 8800 })

    expect(histogram).toBe('types=text:8800,hardBreak:8795,paragraph:25')
  })

  it('caps the histogram and breaks count ties by name', () => {
    const histogram = formatNodeTypeHistogram({ b: 5, a: 5, c: 1 }, 2)

    expect(histogram).toBe('types=a:5,b:5')
  })

  it('reports no types for an empty document', () => {
    expect(formatNodeTypeHistogram({})).toBe('types=none')
  })

  it('formats every count for the log line', () => {
    const formatted = formatEditorDocShape({
      nodes: 5,
      blocks: 2,
      codeBlocks: 1,
      codeLines: 40,
      textChars: 120,
      wikilinks: 3,
      nodeTypes: { text: 3, paragraph: 2 },
    })

    expect(formatted).toBe(
      'nodes=5 textBlocks=2 wikilinks=3 codeBlocks=1 codeLines=40 textChars=120 types=text:3,paragraph:2',
    )
  })
})
