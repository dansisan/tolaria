import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import { requestCreateNoteFromSelection } from '../hooks/noteFromSelectionRequests'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import {
  MOVE_SELECTION_TO_NEW_NOTE_EVENT,
  dispatchMoveSelectionAvailability,
} from '../utils/moveSelectionEvents'
import { isMac } from '../utils/platform'
import { canonicalWikilinkTargetForEntry } from '../utils/wikilink'
import {
  captureSelectionToMove,
  replaceSelectionWithWikilink,
  type SelectionToMove,
} from './moveSelectionToNewNote'
import type { TolariaMoveToNewNoteAction } from './tolariaEditorFormatting'

interface Options {
  editor: ReturnType<typeof useCreateBlockNote>
  locale: AppLocale
  sourceEntry?: VaultEntry | null
  vaultPath?: string
}

const MOVE_TO_NEW_NOTE_SHORTCUT_LABEL = () => (isMac() ? '⌥M' : 'Alt+M')

/** "Move to new note": snapshot the selection, ask for a name, create the note, link it in place. */
export function useMoveSelectionToNewNote({ editor, locale, sourceEntry, vaultPath }: Options) {
  const [open, setOpen] = useState(false)
  const movedRef = useRef<SelectionToMove | null>(null)
  const latestRef = useRef({ sourceEntry, vaultPath })
  useEffect(() => {
    latestRef.current = { sourceEntry, vaultPath }
  }, [sourceEntry, vaultPath])

  const openDialog = useCallback(() => {
    const moved = captureSelectionToMove(editor, latestRef.current.vaultPath)
    if (!moved) return
    movedRef.current = moved
    setOpen(true)
  }, [editor])

  const close = useCallback(() => {
    setOpen(false)
    movedRef.current = null
    editor.focus()
  }, [editor])

  const submit = useCallback(async (title: string) => {
    const moved = movedRef.current
    if (!moved) return
    const entry = await requestCreateNoteFromSelection(title, moved.markdown)
    if (!entry) {
      // Creation failed (e.g. name collision); the app already toasted. Keep the dialog open to retry.
      return
    }
    const { sourceEntry: source, vaultPath: vault } = latestRef.current
    setOpen(false)
    movedRef.current = null
    replaceSelectionWithWikilink(editor, moved, canonicalWikilinkTargetForEntry(entry, vault ?? '', source ?? undefined))
    trackEvent('note_moved_from_selection', { multi_block: moved.blockIds ? 1 : 0 })
  }, [editor])

  const action = useMemo<TolariaMoveToNewNoteAction>(() => ({
    label: createTranslator(locale)('editor.moveToNewNote.button'),
    shortcut: MOVE_TO_NEW_NOTE_SHORTCUT_LABEL(),
    onClick: openDialog,
  }), [locale, openDialog])

  // Keep the Edit menu item enabled only while the editor has focus and highlighted text.
  useEffect(() => {
    let last: boolean | null = null
    const publish = () => {
      const focusInEditor = !!editor.domElement?.contains(document.activeElement)
      const enabled = editor.isEditable && focusInEditor && !editor.prosemirrorState.selection.empty
      if (enabled === last) return
      last = enabled
      dispatchMoveSelectionAvailability(enabled)
    }
    const stopSelection = editor.onSelectionChange(publish)
    document.addEventListener('focusin', publish)
    document.addEventListener('focusout', publish)
    publish()
    return () => {
      stopSelection?.()
      document.removeEventListener('focusin', publish)
      document.removeEventListener('focusout', publish)
      dispatchMoveSelectionAvailability(false)
    }
  }, [editor])

  // ⌥M itself can't be a native menu accelerator (macOS never routes Option-only equivalents to
  // the menu), so claim it here — only with focus in the editor and highlighted text, so ⌥M
  // still types its normal character (µ) everywhere else.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isOptionM = (event.code === 'KeyM' || event.key.toLowerCase() === 'm' || event.key === 'µ')
        && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      if (!isOptionM || !editor.isEditable) return
      if (!editor.domElement?.contains(document.activeElement)) return
      if (editor.prosemirrorState.selection.empty) return
      event.preventDefault()
      event.stopPropagation()
      openDialog()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editor, openDialog])

  // Fired by the native menu item (Edit > Move Selection to New Note), which owns the accelerator.
  useEffect(() => {
    const handleRequest = () => {
      if (editor.isEditable) openDialog()
    }
    window.addEventListener(MOVE_SELECTION_TO_NEW_NOTE_EVENT, handleRequest)
    return () => window.removeEventListener(MOVE_SELECTION_TO_NEW_NOTE_EVENT, handleRequest)
  }, [editor, openDialog])

  return { action, dialogProps: { open, locale, onClose: close, onSubmit: submit } }
}
