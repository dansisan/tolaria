import { useCallback } from 'react'
import { useEditorSave } from './useEditorSave'
import { buildEntryMetadataPatch } from './entryMetadataPatch'
import type { VaultEntry } from '../types'
import type { AppLocale } from '../lib/i18n'

export function useEditorSaveWithLinks(config: {
  updateEntry: (path: string, patch: Partial<VaultEntry>) => void
  setTabs: Parameters<typeof useEditorSave>[0]['setTabs']
  setToastMessage: (msg: string | null) => void
  onAfterSave: () => void
  onBeforePersist?: (path: string) => void
  onNotePersisted?: (path: string, content: string) => void
  resolvePath?: (path: string) => string
  resolvePathBeforeSave?: (path: string) => Promise<string>
  canPersist?: boolean
  persistenceScope?: string | readonly string[]
  disabledSaveMessage?: string
  locale?: AppLocale
}) {
  const { updateEntry, ...saveConfig } = config
  // Note-list/inspector metadata is recomputed at save time (when the note is
  // actually persisted), not on every keystroke. Typing only buffers content;
  // the link/frontmatter/title extraction and the resulting store update happen
  // once per save, keeping the editor responsive on large notes and big vaults.
  const updateVaultContent = useCallback((path: string, content: string) => {
    updateEntry(path, {
      ...buildEntryMetadataPatch(path, content),
      modifiedAt: Math.floor(Date.now() / 1000),
    })
  }, [updateEntry])

  return useEditorSave({ ...saveConfig, updateVaultContent })
}
