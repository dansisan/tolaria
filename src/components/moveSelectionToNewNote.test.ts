import { describe, expect, it, vi } from 'vitest'
import { captureSelectionToMove, replaceSelectionWithWikilink } from './moveSelectionToNewNote'

vi.mock('../utils/editorDurableMarkdown', () => ({
  serializeDurableEditorBlocks: (_editor: unknown, blocks: Array<{ text: string }>) =>
    blocks.map((block) => block.text).join('\n\n'),
}))

function makeEditor(overrides: Record<string, unknown> = {}) {
  return {
    getSelectedText: vi.fn(() => 'long aside'),
    getSelection: vi.fn(() => ({ blocks: [{ id: 'a', text: 'long aside' }] })),
    getSelectionCutBlocks: vi.fn(() => ({ blocks: [{ id: 'a', text: 'long aside' }] })),
    getBlock: vi.fn((id: string) => ({ id })),
    replaceBlocks: vi.fn(),
    insertInlineContent: vi.fn(),
    setTextCursorPosition: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({ block: { id: 'a' } })),
    focus: vi.fn(),
    ...overrides,
  } as never
}

describe('captureSelectionToMove', () => {
  it('uses the cut blocks for a selection inside one block', () => {
    const moved = captureSelectionToMove(makeEditor())
    expect(moved).toEqual({ markdown: 'long aside', blockIds: null, selectedText: 'long aside' })
  })

  it('moves whole top-level blocks for a multi-block selection, skipping nested ones', () => {
    const editor = makeEditor({
      getSelection: vi.fn(() => ({
        blocks: [
          { id: 'a', text: 'one', children: [{ id: 'b', text: 'child' }] },
          { id: 'b', text: 'child' },
          { id: 'c', text: 'two' },
        ],
      })),
    })
    const moved = captureSelectionToMove(editor)
    expect(moved?.blockIds).toEqual(['a', 'c'])
    expect(moved?.markdown).toBe('one\n\ntwo')
  })

  it('returns null when nothing is selected', () => {
    const editor = makeEditor({ getSelectedText: vi.fn(() => ''), getSelection: vi.fn(() => undefined) })
    expect(captureSelectionToMove(editor)).toBeNull()
  })
})

describe('replaceSelectionWithWikilink', () => {
  const link = { type: 'wikilink', props: { target: 'my-note' } }

  it('replaces a still-intact inline selection with the link', () => {
    const editor = makeEditor()
    replaceSelectionWithWikilink(editor, { markdown: 'x', blockIds: null, selectedText: 'long aside' }, 'my-note')
    expect((editor as never as { insertInlineContent: ReturnType<typeof vi.fn> }).insertInlineContent)
      .toHaveBeenCalledWith([link, ' '], { updateSelection: true })
  })

  it('replaces whole blocks with a single paragraph holding the link', () => {
    const editor = makeEditor()
    replaceSelectionWithWikilink(editor, { markdown: 'x', blockIds: ['a', 'c'], selectedText: '' }, 'my-note')
    const replaceBlocks = (editor as never as { replaceBlocks: ReturnType<typeof vi.fn> }).replaceBlocks
    expect(replaceBlocks).toHaveBeenCalledWith([{ id: 'a' }, { id: 'c' }], [{ type: 'paragraph', content: [link] }])
  })

  it('inserts at the caret instead of overwriting when the selection changed', () => {
    const editor = makeEditor({ getSelectedText: vi.fn(() => 'something else') })
    replaceSelectionWithWikilink(editor, { markdown: 'x', blockIds: null, selectedText: 'long aside' }, 'my-note')
    expect((editor as never as { setTextCursorPosition: ReturnType<typeof vi.fn> }).setTextCursorPosition)
      .toHaveBeenCalledWith({ id: 'a' }, 'end')
  })
})

describe('captureSelectionToMove with a collapsed caret', () => {
  it('returns null even though the cursor block is reported as the selection', () => {
    const editor = makeEditor({ getSelectedText: vi.fn(() => '') })
    expect(captureSelectionToMove(editor)).toBeNull()
  })
})
