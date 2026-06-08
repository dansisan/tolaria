/**
 * Markdown line prefixes for block types — the "##" in front of a heading,
 * the "-" of a bullet, … Shown in an editable gutter while the block holds
 * the text cursor (see codeBlockChrome), mirroring the code block fence line.
 */

export interface PrefixableBlock {
  type: string
  props: Record<string, unknown>
}

export interface BlockPrefixUpdate {
  type: string
  props: Record<string, string | number | boolean>
}

export const PREFIXABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
])

const MAX_HEADING_LEVEL = 6

function headingLevel(props: Record<string, unknown>): number {
  const level = props.level
  return typeof level === 'number' && Number.isInteger(level) ? level : 1
}

/** The markdown marker for a block, or null when the type has none. */
export function blockPrefixText({ type, props }: PrefixableBlock): string | null {
  switch (type) {
    case 'heading': return '#'.repeat(Math.min(Math.max(headingLevel(props), 1), MAX_HEADING_LEVEL))
    case 'bulletListItem': return '-'
    case 'numberedListItem': return '1.'
    case 'checkListItem': return props.checked === true ? '- [x]' : '- [ ]'
    case 'quote': return '>'
    default: return null
  }
}

/** Parse an edited marker back into a block update, or null when unknown. */
export function parseBlockPrefix(text: string): BlockPrefixUpdate | null {
  const marker = text.trim()

  if (marker === '') return { type: 'paragraph', props: {} }
  if (/^#{1,6}$/.test(marker)) return { type: 'heading', props: { level: marker.length } }
  if (marker === '-' || marker === '*') return { type: 'bulletListItem', props: {} }
  if (/^\d+\.$/.test(marker)) return { type: 'numberedListItem', props: {} }
  if (marker === '- [ ]') return { type: 'checkListItem', props: { checked: false } }
  if (marker === '- [x]' || marker === '- [X]') return { type: 'checkListItem', props: { checked: true } }
  if (marker === '>') return { type: 'quote', props: {} }
  return null
}
