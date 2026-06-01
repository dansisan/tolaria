import { useEffect } from 'react'

export const NOTE_BODY_FONT_SIZE_PROPERTY = '--note-body-font-size'

/**
 * Publishes the configured note-body font size as a document-level CSS custom
 * property. A stylesheet rule overrides the editor container's inline
 * `--editor-font-size` from it, so the rich editor body (and its caret and
 * placeholder metrics) scale to the user's preference.
 */
export function useNoteBodyFontSize(fontSizePx: number): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty(NOTE_BODY_FONT_SIZE_PROPERTY, `${fontSizePx}px`)
  }, [fontSizePx])
}
