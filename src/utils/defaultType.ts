/** "Note" is the implicit default type; it is never worth showing as a label. */
export function visibleTypeLabel(type: string | null | undefined): string | null {
  if (!type || type.toLowerCase() === 'note') return null
  return type
}
