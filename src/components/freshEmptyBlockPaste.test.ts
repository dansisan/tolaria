import { describe, expect, it, vi } from 'vitest'
import type { ClipboardEvent } from 'react'
import { handleFreshEmptyBlockPlainTextPaste, type InlineContentEditor } from './freshEmptyBlockPaste'

type Harness = {
  result: boolean
  editor: { focus: ReturnType<typeof vi.fn>; insertInlineContent: ReturnType<typeof vi.fn> }
  preventDefault: ReturnType<typeof vi.fn>
}

function pasteInto(blockHtml: string, pastedText: string, editable = true): Harness {
  const container = document.createElement('div')
  container.innerHTML = blockHtml
  document.body.appendChild(container)

  const block = container.firstElementChild as HTMLElement
  const editor = {
    focus: vi.fn(),
    insertInlineContent: vi.fn(),
  } satisfies InlineContentEditor & Record<string, unknown>
  const preventDefault = vi.fn()

  const event = {
    target: block,
    currentTarget: container,
    preventDefault,
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? pastedText : '') },
  } as unknown as ClipboardEvent<HTMLDivElement>

  const result = handleFreshEmptyBlockPlainTextPaste({
    editable,
    editor,
    event,
    runEditorAction: (action) => action(),
  })

  document.body.removeChild(container)
  return { result, editor, preventDefault }
}

describe('handleFreshEmptyBlockPlainTextPaste', () => {
  it('inserts plain text inline when pasting into an empty quote (keeps the quote)', () => {
    const { result, editor, preventDefault } = pasteInto(
      '<div data-content-type="quote"></div>',
      'pasted quote text',
    )

    expect(result).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(editor.insertInlineContent).toHaveBeenCalledWith('pasted quote text', { updateSelection: true })
  })

  it('treats a quote containing only zero-width characters as empty', () => {
    const { result, editor } = pasteInto(
      `<div data-content-type="quote">${"\u200B\uFEFF"}</div>`,
      'text',
    )

    expect(result).toBe(true)
    expect(editor.insertInlineContent).toHaveBeenCalledWith('text', { updateSelection: true })
  })

  it('still handles empty bullet and numbered list items', () => {
    expect(pasteInto('<div data-content-type="bulletListItem"></div>', 'a').result).toBe(true)
    expect(pasteInto('<div data-content-type="numberedListItem"></div>', 'a').result).toBe(true)
    expect(pasteInto('<div data-content-type="checkListItem"></div>', 'a').result).toBe(true)
  })

  it('leaves a non-empty quote to the default paste handler', () => {
    const { result, editor, preventDefault } = pasteInto(
      '<div data-content-type="quote">existing</div>',
      'more',
    )

    expect(result).toBe(false)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(editor.insertInlineContent).not.toHaveBeenCalled()
  })

  it('ignores blocks that are not prefix-sensitive', () => {
    expect(pasteInto('<div data-content-type="paragraph"></div>', 'text').result).toBe(false)
  })

  it('does nothing when not editable', () => {
    const { result } = pasteInto('<div data-content-type="quote"></div>', 'text', false)
    expect(result).toBe(false)
  })

  it('does nothing when there is no plain text on the clipboard', () => {
    const { result } = pasteInto('<div data-content-type="quote"></div>', '')
    expect(result).toBe(false)
  })
})
