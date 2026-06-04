import { createExtension } from '@blocknote/core'
import { requestEditNoteTitle, shouldEnterTitleEditOnArrowUp } from '../utils/editNoteTitleEvent'

interface ProseMirrorViewLike {
  isDestroyed?: boolean
  endOfTextblock: (dir: string) => boolean
  state: { selection: { empty: boolean } }
}

interface CursorPositionLike {
  prevBlock?: unknown
}

interface TitleArrowEditor {
  _tiptapEditor?: { view?: ProseMirrorViewLike }
  prosemirrorView?: ProseMirrorViewLike
  getTextCursorPosition?: () => CursorPositionLike
}

/**
 * Jump from the top of the note body into the title field on a plain Up-arrow.
 * Only fires when the caret sits on the first line of the document's first
 * block (so wrapped paragraphs and lower blocks keep normal cursor movement);
 * otherwise the key passes through to ProseMirror untouched.
 */
export const createEditTitleOnArrowUpExtension = createExtension(({ editor }) => {
  const titleEditor = editor as TitleArrowEditor

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp') return

    const view = titleEditor._tiptapEditor?.view ?? titleEditor.prosemirrorView
    if (!view || view.isDestroyed) return

    let atTopLine = false
    let inFirstBlock = false
    try {
      atTopLine = view.endOfTextblock('up')
      inFirstBlock = titleEditor.getTextCursorPosition?.().prevBlock === undefined
    } catch {
      return
    }

    const shouldEnter = shouldEnterTitleEditOnArrowUp({
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      isComposing: event.isComposing,
      selectionEmpty: view.state.selection.empty,
      atTopLine,
      inFirstBlock,
    })
    if (!shouldEnter) return

    event.preventDefault()
    requestEditNoteTitle()
  }

  return {
    key: 'editTitleOnArrowUp',
    mount: ({ dom, signal }) => {
      // Capture phase so the caret position is read before ProseMirror's own
      // keydown handler can move it.
      dom.addEventListener('keydown', handleKeyDown as EventListener, { capture: true, signal })
    },
  } as const
})
