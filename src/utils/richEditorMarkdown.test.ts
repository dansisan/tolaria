import { describe, expect, it, vi } from 'vitest'
import {
  serializeRichEditorBodyToMarkdown,
  serializeRichEditorBodyToMarkdownCached,
} from './richEditorMarkdown'

function makeEditor(text: string, doc: object | undefined) {
  const document = [{
    type: 'paragraph',
    content: [{ type: 'text', text, styles: {} }],
    children: [],
  }]
  return {
    document,
    blocksToMarkdownLossy: vi.fn(() => `${text}\n`),
    prosemirrorState: doc ? { doc } : undefined,
  }
}

describe('serializeRichEditorBodyToMarkdownCached', () => {
  it('matches the uncached serialization output', () => {
    const doc = {}
    const editor = makeEditor('Body text', doc)
    expect(serializeRichEditorBodyToMarkdownCached(editor as never))
      .toBe(serializeRichEditorBodyToMarkdown(editor as never))
  })

  it('skips re-serialization while the ProseMirror doc is unchanged', () => {
    const doc = {}
    const editor = makeEditor('Stable body', doc)

    const first = serializeRichEditorBodyToMarkdownCached(editor as never)
    const callsAfterFirst = editor.blocksToMarkdownLossy.mock.calls.length
    const second = serializeRichEditorBodyToMarkdownCached(editor as never)

    expect(second).toBe(first)
    expect(editor.blocksToMarkdownLossy.mock.calls.length).toBe(callsAfterFirst)
  })

  it('re-serializes when the doc identity changes', () => {
    const editor = makeEditor('First body', {})
    expect(serializeRichEditorBodyToMarkdownCached(editor as never)).toContain('First body')

    const edited = makeEditor('Second body', {})
    expect(serializeRichEditorBodyToMarkdownCached(edited as never)).toContain('Second body')
  })

  it('serializes directly when the ProseMirror state is unavailable', () => {
    const editor = makeEditor('No state body', undefined)

    expect(serializeRichEditorBodyToMarkdownCached(editor as never)).toContain('No state body')
    const callsAfterFirst = editor.blocksToMarkdownLossy.mock.calls.length
    serializeRichEditorBodyToMarkdownCached(editor as never)
    expect(editor.blocksToMarkdownLossy.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })
})
