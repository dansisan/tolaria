import { useEffect } from 'react'

export const CODE_FONT_SIZE_PROPERTY = '--code-font-size'

/**
 * Publishes the configured code font size as a document-level CSS custom
 * property consumed by the editor's code-block and inline-code rules. When no
 * size is configured the property is removed so those rules fall back to the
 * theme defaults (inline code keeps the theme size, code blocks follow the
 * note-body size).
 */
export function useCodeFontSize(fontSizePx: number | null): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (fontSizePx === null) {
      document.documentElement.style.removeProperty(CODE_FONT_SIZE_PROPERTY)
      return
    }
    document.documentElement.style.setProperty(CODE_FONT_SIZE_PROPERTY, `${fontSizePx}px`)
  }, [fontSizePx])
}
