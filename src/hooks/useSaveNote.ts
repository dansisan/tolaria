import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke, updateMockContent } from '../mock-tauri'
import { cacheNoteContent } from './useTabManagement'

/** Event fired after a save drops image references, carrying the removed links. */
export const ATTACHMENTS_UNLINKED_EVENT = 'laputa:attachments-unlinked'

function notifyAttachmentsUnlinked(notePath: string, removedLinks: string[] | undefined): void {
  if (!removedLinks || removedLinks.length === 0) return
  window.dispatchEvent(
    new CustomEvent(ATTACHMENTS_UNLINKED_EVENT, { detail: { notePath, removedLinks } }),
  )
}

export async function persistContent(path: string, content: string): Promise<void> {
  if (isTauri()) {
    const removedLinks = await invoke<string[]>('save_note_content', { path, content })
    notifyAttachmentsUnlinked(path, removedLinks)
  } else {
    await mockInvoke('save_note_content', { path, content })
  }
}

/**
 * Hook that provides an explicit save function for note content.
 * Called on Cmd+S — no debounce, no auto-save.
 *
 * @param updateContent - callback to also update in-memory state after save
 */
export function useSaveNote(updateContent: (path: string, content: string) => void) {
  const saveNote = useCallback(async (path: string, content: string) => {
    await persistContent(path, content)
    cacheNoteContent(path, content)
    if (!isTauri()) {
      updateMockContent(path, content)
    }
    updateContent(path, content)
  }, [updateContent])

  return { saveNote }
}
