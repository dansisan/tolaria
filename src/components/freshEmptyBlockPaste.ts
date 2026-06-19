import type { ClipboardEvent } from 'react'

export type InlineContentEditor = {
  focus: () => void
  insertInlineContent: (content: string, options: { updateSelection: true }) => void
}

type FreshEmptyBlockPasteOptions = {
  editable: boolean
  editor: InlineContentEditor
  event: ClipboardEvent<HTMLDivElement>
  runEditorAction: (action: () => void) => void
}

// Blocks whose markdown markers BlockNote re-parses on paste, which busts an
// empty block out of its own type (e.g. pasting into a fresh quote turns it
// into a plain paragraph). We intercept the paste and insert plain inline
// content so the freshly-created block keeps its type.
const FRESH_EMPTY_BLOCK_SELECTOR = [
  '[data-content-type="quote"]',
  '[data-content-type="bulletListItem"]',
  '[data-content-type="checkListItem"]',
  '[data-content-type="numberedListItem"]',
].join(', ')

function eventTargetElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  return target instanceof Node ? target.parentElement : null
}

function isBlockEmpty(block: HTMLElement): boolean {
  return (block.textContent ?? '').replace(/[\u200B\uFEFF]/g, '').trim().length === 0
}

export function handleFreshEmptyBlockPlainTextPaste({
  editable,
  editor,
  event,
  runEditorAction,
}: FreshEmptyBlockPasteOptions): boolean {
  if (!editable) return false

  const target = eventTargetElement(event.target)
  const block = target?.closest<HTMLElement>(FRESH_EMPTY_BLOCK_SELECTOR)
  if (!block || !event.currentTarget.contains(block)) return false
  if (!isBlockEmpty(block)) return false

  const text = event.clipboardData.getData('text/plain')
  if (text.length === 0) return false

  event.preventDefault()
  runEditorAction(() => {
    editor.focus()
    editor.insertInlineContent(text, { updateSelection: true })
  })
  return true
}
