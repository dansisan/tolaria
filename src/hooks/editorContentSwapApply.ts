import type { MutableRefObject } from 'react'
import type { Transaction } from 'prosemirror-state'
import type { useCreateBlockNote } from '@blocknote/react'
import { blankParagraphBlocks } from './editorTabContent'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import { resetTextSelectionBeforeContentSwap } from './editorTiptapSelection'
import { repairMalformedEditorBlocks } from './editorBlockRepair'

type EditorBlocks = unknown[]

export type EditorContentPathRef = MutableRefObject<string | null>

interface AppliedEditorContentCommit {
  editorContentPathRef: EditorContentPathRef
  scrollTop: number
  suppressChangeRef: MutableRefObject<boolean>
  targetPath: string
}

interface ApplyBlocksToEditorOptions extends AppliedEditorContentCommit {
  editor: ReturnType<typeof useCreateBlockNote>
  blocks: EditorBlocks
}

interface ApplyBlankStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
}

interface ApplyMarkupStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
  markup: string
}

export function applyBlocksToEditor(options: ApplyBlocksToEditorOptions): boolean {
  const {
    editor,
    blocks,
    suppressChangeRef,
  } = options
  const safeBlocks = repairMalformedEditorBlocks(blocks)
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    // Load the note's content without recording it in the undo history. The
    // BlockNote editor instance is reused across notes, so a recordable swap
    // would let Cmd+Z undo the content load itself — emptying the note (or
    // reverting to a previously open note's content). Marking the transaction
    // `addToHistory: false` keeps undo scoped to the user's edits since open.
    editor.transact((tr: Transaction) => {
      tr.setMeta('addToHistory', false)
      const current = editor.document
      if (current.length > 0 && safeBlocks.length > 0) {
        editor.replaceBlocks(current, safeBlocks)
      } else if (safeBlocks.length > 0) {
        editor.insertBlocks(safeBlocks, current[0], 'before')
      }
    })
  } catch (err) {
    console.error('applyBlocks failed, trying fallback:', err)
    try {
      const markup = editor.blocksToHTMLLossy(safeBlocks)
      editor._tiptapEditor.commands.setContent(markup)
    } catch (err2) {
      console.error('Fallback also failed:', err2)
      suppressChangeRef.current = false
      return false
    }
  }

  commitAppliedEditorContent(options)
  return true
}

export function applyBlankStateToEditor(options: ApplyBlankStateToEditorOptions): boolean {
  return applyBlocksToEditor({ ...options, blocks: blankParagraphBlocks(), scrollTop: 0 })
}

export function applyHtmlStateToEditor(options: ApplyMarkupStateToEditorOptions) {
  const {
    editor,
    markup,
    suppressChangeRef,
  } = options
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    editor._tiptapEditor.commands.setContent(markup)
  } catch (err) {
    console.error('applyHtmlStateToEditor failed:', err)
    suppressChangeRef.current = false
    throw err
  }

  commitAppliedEditorContent({ ...options, scrollTop: 0 })
}

function commitAppliedEditorContent(options: AppliedEditorContentCommit) {
  const {
    editorContentPathRef,
    scrollTop,
    suppressChangeRef,
    targetPath,
  } = options

  requestNextFrame(() => {
    editorContentPathRef.current = targetPath
    suppressChangeRef.current = false
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
  })
}

function requestNextFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(() => callback(Date.now()), 0)
}
