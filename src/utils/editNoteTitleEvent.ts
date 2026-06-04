/** Fired to put the breadcrumb title (filename) into edit mode from elsewhere. */
export const EDIT_NOTE_TITLE_EVENT = 'laputa:edit-note-title'

export function requestEditNoteTitle(): void {
  window.dispatchEvent(new CustomEvent(EDIT_NOTE_TITLE_EVENT))
}

export interface TitleEditArrowContext {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
  /** The editor selection is collapsed (a plain caret, not a range). */
  selectionEmpty: boolean
  /** Pressing Up would leave the current text block upward (caret on its first line). */
  atTopLine: boolean
  /** The caret is in the document's first block (no block above it). */
  inFirstBlock: boolean
}

/**
 * True when an unmodified Up-arrow should jump from the top of the note body
 * into the title field instead of moving the caret. Requires a collapsed caret
 * on the first line of the first block, so wrapped first paragraphs and lower
 * blocks keep normal cursor movement.
 */
export function shouldEnterTitleEditOnArrowUp(ctx: TitleEditArrowContext): boolean {
  return ctx.key === 'ArrowUp'
    && !ctx.shiftKey
    && !ctx.metaKey
    && !ctx.ctrlKey
    && !ctx.altKey
    && !ctx.isComposing
    && ctx.selectionEmpty
    && ctx.atTopLine
    && ctx.inFirstBlock
}
