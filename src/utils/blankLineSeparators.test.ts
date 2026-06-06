import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import {
  injectBlankLineSeparatorBlocks,
  markBlankSeparatorBlocksForSerialization,
  preProcessBlankLineSeparators,
  restoreBlankLineSeparators,
} from './blankLineSeparators'
import { compactMarkdown } from './compact-markdown'
import { resolveBlocksForTarget } from '../hooks/editorBlockResolution'
import { serializeRichEditorDocumentToMarkdown } from './richEditorMarkdown'
import { schema } from '../components/editorSchema'

const TOKEN = '@@TOLARIA-BLANK-SEPARATOR@@'

describe('preProcessBlankLineSeparators', () => {
  it('keeps single blank lines untouched', () => {
    const md = 'para one\n\npara two'
    expect(preProcessBlankLineSeparators({ markdown: md })).toBe(md)
  })

  it('replaces a double blank line with a sentinel paragraph', () => {
    expect(preProcessBlankLineSeparators({ markdown: 'para one\n\n\npara two' }))
      .toBe(`para one\n\n${TOKEN}\n\npara two`)
  })

  it('collapses 3+ blank lines into one sentinel', () => {
    expect(preProcessBlankLineSeparators({ markdown: 'a\n\n\n\n\nb' }))
      .toBe(`a\n\n${TOKEN}\n\nb`)
  })

  it('leaves blank runs inside code fences alone', () => {
    const md = '```\nline\n\n\nmore\n```\n\nafter'
    expect(preProcessBlankLineSeparators({ markdown: md })).toBe(md)
  })

  it('leaves leading blank lines alone', () => {
    const md = '\n\n\nfirst para'
    expect(preProcessBlankLineSeparators({ markdown: md })).toBe(md)
  })

  it('leaves trailing blank lines alone', () => {
    const md = 'last para\n\n\n'
    expect(preProcessBlankLineSeparators({ markdown: md })).toBe(md)
  })

  it('skips runs followed by an indented continuation line', () => {
    const md = '- item\n\n\n  continued'
    expect(preProcessBlankLineSeparators({ markdown: md })).toBe(md)
  })
})

describe('injectBlankLineSeparatorBlocks', () => {
  it('turns sentinel paragraphs into empty paragraphs', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'a', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: TOKEN, styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'b', styles: {} }] },
    ]
    const injected = injectBlankLineSeparatorBlocks(blocks) as Array<{ content: unknown[] }>
    expect(injected[1].content).toEqual([])
    expect(injected[0]).toBe(blocks[0])
    expect(injected[2]).toBe(blocks[2])
  })

  it('ignores paragraphs that merely contain the token among other text', () => {
    const blocks = [{
      type: 'paragraph',
      content: [{ type: 'text', text: `before ${TOKEN}`, styles: {} }],
    }]
    expect(injectBlankLineSeparatorBlocks(blocks)).toEqual(blocks)
  })
})

describe('markBlankSeparatorBlocksForSerialization', () => {
  it('marks top-level empty paragraphs with the sentinel', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'a', styles: {} }], children: [] },
      { type: 'paragraph', content: [], children: [] },
    ]
    const marked = markBlankSeparatorBlocksForSerialization(blocks) as Array<{ content: unknown[] }>
    expect(marked[1].content).toEqual([{ type: 'text', text: TOKEN, styles: {} }])
    expect(marked[0]).toBe(blocks[0])
  })

  it('leaves empty paragraphs with children alone', () => {
    const blocks = [{
      type: 'paragraph',
      content: [],
      children: [{ type: 'paragraph', content: [] }],
    }]
    expect(markBlankSeparatorBlocksForSerialization(blocks)).toEqual(blocks)
  })
})

describe('restoreBlankLineSeparators', () => {
  it('returns markdown without tokens unchanged', () => {
    const md = 'a\n\nb\n'
    expect(restoreBlankLineSeparators(md)).toBe(md)
  })

  it('converts a sentinel line into a double blank line', () => {
    expect(restoreBlankLineSeparators(`a\n\n${TOKEN}\n\nb\n`)).toBe('a\n\n\nb\n')
  })

  it('caps consecutive separators at one double blank line', () => {
    expect(restoreBlankLineSeparators(`a\n\n${TOKEN}\n\n${TOKEN}\n\nb\n`)).toBe('a\n\n\nb\n')
  })

  it('drops leading and trailing separators', () => {
    expect(restoreBlankLineSeparators(`${TOKEN}\n\na\n\n${TOKEN}\n`)).toBe('a\n')
  })
})

describe('round trip through BlockNote', () => {
  it('preserves a double blank line across parse and serialize', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const source = 'para one\n\npara two\n\n\npara three\n'

    const preprocessed = preProcessBlankLineSeparators({ markdown: source })
    const blocks = injectBlankLineSeparatorBlocks(
      await editor.tryParseMarkdownToBlocks(preprocessed),
    )

    expect(blocks.map((b) => (b as { content: unknown[] }).content.length)).toEqual([1, 1, 0, 1])

    const marked = markBlankSeparatorBlocksForSerialization(blocks)
    const serialized = restoreBlankLineSeparators(
      compactMarkdown(editor.blocksToMarkdownLossy(marked as never)),
    )
    expect(serialized).toBe(source)
  })

  it('preserves a double blank line through the app load and save entry points', async () => {
    const parseEditor = BlockNoteEditor.create({ schema })
    const source = 'para one\n\npara two\n\n\npara three\n'

    const resolved = await resolveBlocksForTarget({
      editor: parseEditor as never,
      cache: new Map(),
      targetPath: '/test/vault/blank-separator-note.md',
      content: source,
    })
    const contentLengths = resolved.blocks.map(
      (b) => ((b as { content?: unknown[] }).content ?? []).length,
    )
    expect(contentLengths).toEqual([1, 1, 0, 1])

    const saveEditor = BlockNoteEditor.create({ schema, initialContent: resolved.blocks as never })
    expect(serializeRichEditorDocumentToMarkdown(saveEditor as never, source)).toBe(source)
  })
})
