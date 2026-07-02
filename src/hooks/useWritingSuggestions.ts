import { useEffect } from 'react'

export const WRITING_SUGGESTIONS_ATTRIBUTE = 'writingsuggestions'

/**
 * Controls macOS/Safari inline predictive text (the grey word completions you
 * Tab to accept) across every editable surface in the app.
 *
 * `writingsuggestions` is an inheritable HTML attribute, so setting it on the
 * document root disables predictions for all descendant editors and inputs at
 * once — no per-element wiring or editor reconfigure. When the feature is
 * enabled we remove the attribute, letting the platform default (on) apply.
 *
 * Left on, the OS recomputes predictions on every keystroke, which is a felt
 * typing lag even on small notes — so this defaults to disabled.
 */
export function useWritingSuggestions(enabled: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (enabled) root.removeAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)
    else root.setAttribute(WRITING_SUGGESTIONS_ATTRIBUTE, 'false')
  }, [enabled])
}
