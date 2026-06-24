import { createTranslator, type AppLocale } from '../../lib/i18n'
import type { CommandAction } from './types'

interface AppleNotesCommandsConfig {
  locale?: AppLocale
  enabled?: boolean
  onImportAppleNotes?: () => void
}

export function buildAppleNotesCommands({
  locale = 'en',
  enabled = false,
  onImportAppleNotes,
}: AppleNotesCommandsConfig): CommandAction[] {
  if (!onImportAppleNotes) return []
  const t = createTranslator(locale)
  return [
    {
      id: 'import-apple-notes',
      label: t('command.importAppleNotes'),
      group: 'Note',
      keywords: ['apple', 'notes', 'import', 'migrate', 'macos', 'icloud'],
      enabled,
      execute: onImportAppleNotes,
    },
  ]
}
