import { describe, expect, it } from 'vitest'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import type { Decoration, DecorationSet } from 'prosemirror-view'
import {
  applyCodeBlockLineNumberDecorations,
  buildCodeBlockLineNumberDecorations,
  codeBlockLineStarts,
} from './codeBlockLineNumberExtension'

describe('codeBlockLineStarts', () => {
  it('numbers a single line from its content start', () => {
    expect(codeBlockLineStarts('const x = 1', 1)).toEqual([{ pos: 1, line: 1 }])
  })

  it('opens line 2 at the position right after the newline', () => {
    // "ab\ncd" with content starting at doc position 1:
    // a=1 b=2 \n=3 c=4 d=5 → line 2 starts at 4.
    expect(codeBlockLineStarts('ab\ncd', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 4, line: 2 },
    ])
  })

  it('counts a trailing newline as a final empty line', () => {
    expect(codeBlockLineStarts('ab\n', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 4, line: 2 },
    ])
  })

  it('offsets every line by the given content start', () => {
    expect(codeBlockLineStarts('a\nb\nc', 10)).toEqual([
      { pos: 10, line: 1 },
      { pos: 12, line: 2 },
      { pos: 14, line: 3 },
    ])
  })

  it('treats empty content as a single line', () => {
    expect(codeBlockLineStarts('', 5)).toEqual([{ pos: 5, line: 1 }])
  })

  it('numbers consecutive blank lines', () => {
    expect(codeBlockLineStarts('\n\n', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 2, line: 2 },
      { pos: 3, line: 3 },
    ])
  })
})

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
    text: {},
  },
})

function doc(...children: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('doc', null, children)
}

function paragraph(text: string): ProseMirrorNode {
  return schema.node('paragraph', null, text ? [schema.text(text)] : [])
}

function codeBlock(text: string): ProseMirrorNode {
  return schema.node('codeBlock', null, text ? [schema.text(text)] : [])
}

function decorationLine(decoration: Decoration): string {
  return (decoration.spec as { key: string }).key.split('-').pop() ?? ''
}

/** Position + line number of every widget — stable across mapping, unlike keys. */
function decorationFingerprint(set: DecorationSet): string[] {
  return set.find().map((decoration) => `${decoration.from}:${decorationLine(decoration)}`).sort()
}

function expectMatchesFullRebuild(set: DecorationSet, document: ProseMirrorNode) {
  expect(decorationFingerprint(set)).toEqual(
    decorationFingerprint(buildCodeBlockLineNumberDecorations(document)),
  )
}

describe('applyCodeBlockLineNumberDecorations', () => {
  it('returns the previous set instance when the document did not change', () => {
    const state = EditorState.create({ doc: doc(codeBlock('a\nb'), paragraph('hi')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const next = applyCodeBlockLineNumberDecorations(state.tr.setMeta('probe', true), previous)

    expect(next).toBe(previous)
  })

  it('matches a full rebuild after adding a line inside a code block', () => {
    const state = EditorState.create({ doc: doc(codeBlock('ab\ncd')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.insertText('\nx', 3)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expect(next.find()).toHaveLength(3)
    expectMatchesFullRebuild(next, tr.doc)
  })

  it('matches a full rebuild after deleting a line inside a code block', () => {
    const state = EditorState.create({ doc: doc(codeBlock('ab\ncd\nef')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.delete(3, 6)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expect(next.find()).toHaveLength(2)
    expectMatchesFullRebuild(next, tr.doc)
  })

  it('shifts and reuses untouched code-block widgets when typing outside them', () => {
    const state = EditorState.create({ doc: doc(paragraph('hello'), codeBlock('a\nb')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)
    const previousSpecs = new Set(previous.find().map((decoration) => decoration.spec))

    const tr = state.tr.insertText('!!', 6)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expectMatchesFullRebuild(next, tr.doc)
    expect(next.find().every((decoration) => previousSpecs.has(decoration.spec))).toBe(true)
  })

  it('reuses widgets of other code blocks when editing one of several', () => {
    const state = EditorState.create({ doc: doc(codeBlock('a\nb'), codeBlock('c\nd')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)
    const firstBlockSpecs = new Set(
      previous.find(0, state.doc.child(0).nodeSize).map((decoration) => decoration.spec),
    )

    const secondBlockStart = state.doc.child(0).nodeSize
    const tr = state.tr.insertText('\nz', secondBlockStart + 2)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expectMatchesFullRebuild(next, tr.doc)
    const firstBlockWidgets = next.find(0, tr.doc.child(0).nodeSize)
    expect(firstBlockWidgets.every((decoration) => firstBlockSpecs.has(decoration.spec))).toBe(true)
  })

  it('drops decorations when a code block becomes a paragraph', () => {
    const state = EditorState.create({ doc: doc(codeBlock('a\nb')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.setBlockType(1, 1, schema.nodes.paragraph)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expect(next.find()).toHaveLength(0)
  })

  it('numbers a paragraph converted into a code block', () => {
    const state = EditorState.create({ doc: doc(paragraph('a\nb')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.setBlockType(1, 1, schema.nodes.codeBlock)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expectMatchesFullRebuild(next, tr.doc)
    expect(next.find()).toHaveLength(2)
  })

  it('renumbers both halves when a code block is split', () => {
    const state = EditorState.create({ doc: doc(codeBlock('ab\ncd')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.split(4)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expectMatchesFullRebuild(next, tr.doc)
  })

  it('renumbers the merged block when two code blocks are joined', () => {
    const state = EditorState.create({ doc: doc(codeBlock('ab'), codeBlock('cd')) })
    const previous = buildCodeBlockLineNumberDecorations(state.doc)

    const tr = state.tr.join(state.doc.child(0).nodeSize)
    const next = applyCodeBlockLineNumberDecorations(tr, previous)

    expectMatchesFullRebuild(next, tr.doc)
  })
})
