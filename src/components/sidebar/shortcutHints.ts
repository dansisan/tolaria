export function formatShortcutHint(shift: boolean, index: number, mac: boolean): string {
  return mac ? `${shift ? '⌘⇧' : '⌘'}${index}` : `${shift ? 'Ctrl+Shift+' : 'Ctrl+'}${index}`
}

export const MAX_SHORTCUT_ITEMS = 9
