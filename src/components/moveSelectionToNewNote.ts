import type { useCreateBlockNote } from '@blocknote/react'
import { compactMarkdown } from '../utils/compact-markdown'
import { serializeDurableEditorBlocks } from '../utils/editorDurableMarkdown'
import { restoreWikilinksInBlocks } from '../utils/wikilinks'

type Editor = ReturnType<typeof useCreateBlockNote>
type SelectionBlock = { id: string; children?: SelectionBlock[] }

export interface SelectionToMove {
  markdown: string
  /** Set when the selection spans several blocks; those whole blocks are replaced by the link. */
  blockIds: string[] | null
  selectedText: string
}

function nestedBlockIds(blocks: SelectionBlock[]): Set<string> {
  const nested = new Set<string>()
  const visit = (children: SelectionBlock[] = []) => {
    for (const child of children) {
      nested.add(child.id)
      visit(child.children)
    }
  }
  for (const block of blocks) visit(block.children)
  return nested
}

function serialize(editor: Editor, blocks: unknown[], vaultPath?: string): string {
  return compactMarkdown(serializeDurableEditorBlocks(editor, restoreWikilinksInBlocks(blocks), vaultPath)).trim()
}

/** Snapshot what the user has selected so it can be moved after a dialog steals focus. */
export function captureSelectionToMove(editor: Editor, vaultPath?: string): SelectionToMove | null {
  const selectedText = editor.getSelectedText()
  const selected = (editor.getSelection()?.blocks ?? []) as unknown as SelectionBlock[]
  if (!selectedText.trim() && selected.length < 2) return null

  if (selected.length > 1) {
    const nested = nestedBlockIds(selected)
    const topLevel = selected.filter((block) => !nested.has(block.id))
    return { markdown: serialize(editor, topLevel, vaultPath), blockIds: topLevel.map((block) => block.id), selectedText }
  }

  const { blocks } = editor.getSelectionCutBlocks()
  return { markdown: serialize(editor, blocks, vaultPath), blockIds: null, selectedText }
}

/** Replace the moved content with a wikilink to the new note. */
export function replaceSelectionWithWikilink(editor: Editor, moved: SelectionToMove, target: string): void {
  const link = { type: 'wikilink' as const, props: { target } }
  editor.focus()

  if (moved.blockIds) {
    const blocks = moved.blockIds
      .map((id) => editor.getBlock(id))
      .filter((block): block is NonNullable<typeof block> => !!block)
    if (blocks.length > 0) {
      editor.replaceBlocks(blocks, [{ type: 'paragraph', content: [link] }])
      return
    }
  }

  // Only overwrite the selection if it is still what we captured; otherwise insert at the caret.
  const selectionUnchanged = editor.getSelectedText() === moved.selectedText
  if (!selectionUnchanged) editor.setTextCursorPosition(editor.getTextCursorPosition().block, 'end')
  editor.insertInlineContent([link, ' '], { updateSelection: true })
}
