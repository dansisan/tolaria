import type { Settings } from '../types'
import type { PropertyDisplayMode } from './propertyTypes'
import { humanizePropertyKey } from './propertyLabels'
import { canonicalFrontmatterKey } from './systemMetadata'

export interface SuggestedProperty {
  /** The frontmatter key written when the slot is filled. */
  key: string
  /** The row label. */
  label: string
  /** Which editor the slot opens. Custom keys get the plain text editor. */
  mode: PropertyDisplayMode
}

/** Aliases has its own row and editor, so it is never one of the bottom slots. */
export const ALIASES_PROPERTY_KEY = 'aliases'

/**
 * The properties a note is offered before it has any. Each carries the exact
 * frontmatter key to write — `icon` rather than `Icon`, because the writer
 * canonicalizes it to `_icon` — and the editor the slot should open.
 */
const BUILT_IN_SUGGESTED_PROPERTIES: readonly SuggestedProperty[] = [
  { key: 'Status', label: 'Status', mode: 'status' },
  { key: 'Date', label: 'Date', mode: 'date' },
  { key: 'URL', label: 'URL', mode: 'url' },
  { key: 'icon', label: 'Icon', mode: 'text' },
  { key: ALIASES_PROPERTY_KEY, label: 'Aliases', mode: 'text' },
]

export const DEFAULT_SUGGESTED_PROPERTIES: readonly SuggestedProperty[] = BUILT_IN_SUGGESTED_PROPERTIES

export const DEFAULT_SUGGESTED_PROPERTIES_TEXT = BUILT_IN_SUGGESTED_PROPERTIES
  .map((property) => property.label)
  .join(', ')

type SuggestedPropertiesSettings = Pick<Settings, 'suggested_properties'>

/**
 * Resolve one authored key. Matching a built-in by canonical key keeps its
 * write key and editor whatever the user typed, so `Icon`, `icon`, and `_icon`
 * all still write `_icon` and open the same editor.
 */
function resolveSuggestedProperty(key: string): SuggestedProperty {
  const canonical = canonicalFrontmatterKey(key)
  const builtIn = BUILT_IN_SUGGESTED_PROPERTIES
    .find((candidate) => canonicalFrontmatterKey(candidate.key) === canonical)
  return builtIn ?? { key, label: humanizePropertyKey(key), mode: 'text' }
}

/** Split on commas and newlines so a list pasted in either shape works. */
function parseSuggestedProperties(value: string): SuggestedProperty[] {
  const seen = new Set<string>()
  const properties: SuggestedProperty[] = []

  for (const raw of value.split(/[,\n]/)) {
    const key = raw.trim()
    if (key === '') continue
    const canonical = canonicalFrontmatterKey(key)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    properties.push(resolveSuggestedProperty(key))
  }

  return properties
}

/**
 * What to persist. The empty string is meaningful and is kept: it records "the
 * user cleared the list", which leaves the panel with nothing but its
 * "Add property" button. `null` means the list was never set, so the defaults
 * apply. Collapsing the two would make clearing impossible.
 */
export function serializeSuggestedProperties(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

/** The effective properties: empty when cleared, the defaults when never set. */
export function resolveSuggestedProperties(
  settings: SuggestedPropertiesSettings | null | undefined,
): SuggestedProperty[] {
  const stored = serializeSuggestedProperties(settings?.suggested_properties)
  if (stored === null) return [...DEFAULT_SUGGESTED_PROPERTIES]
  return parseSuggestedProperties(stored)
}

/**
 * The editor a key opens. Falls back to the built-in table rather than the
 * configured list, so a key reached without its slot — the note-icon shortcut
 * opens `icon` directly — still gets the editor it has always had.
 */
export function suggestedPropertyMode(
  properties: readonly SuggestedProperty[],
  key: string,
): PropertyDisplayMode {
  const canonical = canonicalFrontmatterKey(key)
  const listed = properties.find((property) => canonicalFrontmatterKey(property.key) === canonical)
  return (listed ?? resolveSuggestedProperty(key)).mode
}

/**
 * Whether an empty Aliases row is offered. A note that already has aliases
 * always shows the row, listed or not — this governs the empty state only.
 */
export function offersAliasesProperty(properties: readonly SuggestedProperty[]): boolean {
  return properties.some((property) => property.key === ALIASES_PROPERTY_KEY)
}

/**
 * The Settings-panel edit shape. Raw text, so a half-typed or cleared list
 * round-trips through the input untouched. Prefilled with the defaults when
 * never set, which is what makes a blank field read as a deliberate "none".
 */
export function suggestedPropertiesDraft(
  settings: SuggestedPropertiesSettings | null | undefined,
): string {
  return serializeSuggestedProperties(settings?.suggested_properties)
    ?? DEFAULT_SUGGESTED_PROPERTIES_TEXT
}

export function suggestedPropertiesFromDraft(draft: string): SuggestedProperty[] {
  return parseSuggestedProperties(draft)
}

/** The persisted form of a draft: labels, so the field reopens as it was shown. */
export function serializeSuggestedPropertiesDraft(draft: string): string {
  return suggestedPropertiesFromDraft(draft).map((property) => property.label).join(', ')
}
