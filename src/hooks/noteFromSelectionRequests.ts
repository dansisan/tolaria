import { useEffect } from 'react'
import type { VaultEntry } from '../types'

export const CREATE_NOTE_FROM_SELECTION_EVENT = 'tolaria:create-note-from-selection'

interface CreateNoteFromSelectionDetail {
  title: string
  body: string
  resolve: (entry: VaultEntry | null) => void
}

type CreateNoteFromSelection = (title: string, body: string) => Promise<VaultEntry | null>

/** Ask the note-creation layer to create a note with `body`, resolving to the new entry (or null on failure). */
export function requestCreateNoteFromSelection(title: string, body: string): Promise<VaultEntry | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<CreateNoteFromSelectionDetail>(CREATE_NOTE_FROM_SELECTION_EVENT, {
      detail: { title, body, resolve },
    }))
  })
}

export function useCreateNoteFromSelectionRequests(create: CreateNoteFromSelection): void {
  useEffect(() => {
    const handleRequest = (event: Event) => {
      const { title, body, resolve } = (event as CustomEvent<CreateNoteFromSelectionDetail>).detail
      create(title, body).then(resolve, () => resolve(null))
    }

    window.addEventListener(CREATE_NOTE_FROM_SELECTION_EVENT, handleRequest)
    return () => window.removeEventListener(CREATE_NOTE_FROM_SELECTION_EVENT, handleRequest)
  }, [create])
}
