import { useMemo } from 'react'
import { createTranslator, type AppLocale } from '../lib/i18n'
import type { InlineCodeChromeTarget } from './inlineCodeChromeState'

export function InlineCodeCopyHint({
  target,
  copied,
  isMacPlatform,
  locale,
}: {
  target: InlineCodeChromeTarget
  copied: boolean
  isMacPlatform: boolean
  locale: AppLocale
}) {
  const t = useMemo(() => createTranslator(locale), [locale])
  const label = copied
    ? t('editor.inlineCode.copied')
    : t(isMacPlatform ? 'editor.inlineCode.copyHintMac' : 'editor.inlineCode.copyHint')

  return (
    <div
      className="editor__inline-code-hint"
      contentEditable={false}
      role="status"
      style={{ left: target.left, top: target.top }}
    >
      {label}
    </div>
  )
}
