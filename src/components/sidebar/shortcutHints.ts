export type ShortcutHintKind = 'command' | 'ctrl-alt'

export function formatShortcutHint(kind: ShortcutHintKind, index: number, mac: boolean): string {
  if (kind === 'ctrl-alt') return mac ? `⌃⌥${index}` : `Ctrl+Alt+${index}`
  return mac ? `⌘${index}` : `Ctrl+${index}`
}

export const MAX_SHORTCUT_ITEMS = 9
