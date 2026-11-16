import type { FrontmatterValue } from '../components/Inspector'

/**
 * A list property can mix wikilinks and plain names (`people: [[[Alice]], Bob]`).
 * The Relationships panel owns the wikilinks; the Properties panel shows the plain names.
 * These helpers keep the two halves from clobbering each other.
 */
const WIKILINK_ITEM = /^\[\[.*\]\]$/

function isWikilinkItem(item: unknown): item is string {
  return typeof item === 'string' && WIKILINK_ITEM.test(item)
}

/** The wikilink items of a list value (empty for scalars and plain lists). */
export function wikilinkItems(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isWikilinkItem) : []
}

/**
 * What the Properties panel should show for a value: scalars and plain lists unchanged,
 * a mixed list reduced to its plain items, and undefined (hide the row) when only wikilinks remain.
 * A literal `null` is an empty field and stays visible.
 */
export function propertiesPanelValue(value: FrontmatterValue): FrontmatterValue | undefined {
  if (typeof value === 'string') return isWikilinkItem(value) ? undefined : value
  if (!Array.isArray(value)) return value
  const links = wikilinkItems(value)
  if (links.length === 0) return value
  const plain = value.filter((item) => !isWikilinkItem(item))
  if (plain.length === 0) return undefined
  return plain.length === 1 ? plain[0] : plain
}

/** The plain (non-wikilink) names in a field's value; a lone plain string counts as one. */
export function plainItems(value: FrontmatterValue | undefined): string[] {
  if (typeof value === 'string') return isWikilinkItem(value) || value === '' ? [] : [value]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !isWikilinkItem(item)) : []
}

/** A field value made of the given links followed by the field's existing plain names. */
export function linksWithPlainItems(existing: FrontmatterValue | undefined, links: string[]): FrontmatterValue | null {
  const merged = [...links, ...plainItems(existing)]
  if (merged.length === 0) return null
  return merged.length === 1 ? merged[0] : merged
}

/** Put a mixed list's wikilinks back in front of an edited list of plain items. */
export function withPreservedWikilinks(existing: FrontmatterValue | undefined, edited: FrontmatterValue): FrontmatterValue {
  const links = wikilinkItems(existing)
  if (links.length === 0) return edited
  const plain = Array.isArray(edited) ? edited : [edited]
  const merged = [...links, ...plain.map(String)]
  return merged.length === 1 ? merged[0] : merged
}
