/** Fired to hand keyboard focus to the note body (consumed by useEditorFocus). */
export const FOCUS_EDITOR_EVENT = 'laputa:focus-editor'

/**
 * Request focus on the open note's editor body.
 *
 * When `path` is provided, useEditorFocus waits for that note's tab swap before
 * focusing, so this is safe to call immediately after opening a different note
 * (e.g. from quick open or the note list) while its content is still loading.
 */
export function requestEditorFocus(path?: string | null): void {
  window.dispatchEvent(new CustomEvent(FOCUS_EDITOR_EVENT, {
    detail: { path: path ?? null },
  }))
}
