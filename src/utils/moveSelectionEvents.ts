export const MOVE_SELECTION_TO_NEW_NOTE_EVENT = 'tolaria:move-selection-to-new-note'

/** Ask the focused editor to start "Move to new note" for its current selection. */
export function dispatchMoveSelectionToNewNote() {
  window.dispatchEvent(new Event(MOVE_SELECTION_TO_NEW_NOTE_EVENT))
}

export const MOVE_SELECTION_AVAILABILITY_EVENT = 'tolaria:move-selection-availability'

/** Tell the native menu whether the editor has highlighted text, so it can enable or free its accelerator. */
export function dispatchMoveSelectionAvailability(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<{ enabled: boolean }>(
    MOVE_SELECTION_AVAILABILITY_EVENT,
    { detail: { enabled } },
  ))
}

export function readMoveSelectionAvailability(event: Event): boolean | null {
  if (!(event instanceof CustomEvent)) return null
  const enabled = (event.detail as { enabled?: unknown } | null)?.enabled
  return typeof enabled === 'boolean' ? enabled : null
}
