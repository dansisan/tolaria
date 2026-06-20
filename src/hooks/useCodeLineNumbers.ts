import { useEffect } from 'react'

export const CODE_LINE_NUMBERS_ATTRIBUTE = 'data-code-line-numbers'

/**
 * Toggles the document-level `data-code-line-numbers` attribute consumed by the
 * editor's code-block gutter rules. The line-number widget decorations are
 * always present (see codeBlockLineNumberExtension); this attribute is the only
 * thing that reveals them, so flipping the setting is a pure CSS change with no
 * editor re-render.
 */
export function useCodeLineNumbers(enabled: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (enabled) root.setAttribute(CODE_LINE_NUMBERS_ATTRIBUTE, 'true')
    else root.removeAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)
  }, [enabled])
}
