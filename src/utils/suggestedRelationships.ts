import type { Settings } from '../types'
import { canonicalFrontmatterKey } from './systemMetadata'

/**
 * The relationship vocabulary a vault starts with. It drives two things: the
 * ready-to-fill slots the Inspector offers, and whether a key a Type schema
 * declares without a wikilink value belongs to the Relationships panel rather
 * than Properties. Both must read the same list or a schema key would show in
 * both panels, or in neither.
 */
export const DEFAULT_SUGGESTED_RELATIONSHIPS: readonly string[] = ['belongs_to', 'related_to', 'has']

export const DEFAULT_SUGGESTED_RELATIONSHIPS_TEXT = DEFAULT_SUGGESTED_RELATIONSHIPS.join(', ')

type SuggestedRelationshipsSettings = Pick<Settings, 'suggested_relationships'>

/** Frontmatter keys keep their authored casing and separators, so match past both. */
function normalizeRelationshipKey(key: string): string {
  return canonicalFrontmatterKey(key.trim().replace(/[\s-]+/g, '_'))
}

/** Whether a frontmatter key names one of the configured relationships. */
export function includesRelationshipKey(keys: readonly string[], key: string): boolean {
  const wanted = normalizeRelationshipKey(key)
  return keys.some((candidate) => normalizeRelationshipKey(candidate) === wanted)
}

/**
 * Split on commas and newlines so a list pasted in either shape works, and keep
 * the author's own spelling and order: the keys are written into frontmatter.
 */
function parseSuggestedRelationships(value: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  for (const raw of value.split(/[,\n]/)) {
    const key = raw.trim()
    if (key === '') continue
    const canonical = normalizeRelationshipKey(key)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    keys.push(key)
  }

  return keys
}

/**
 * What to persist. The empty string is meaningful and is kept: it records "the
 * user cleared the list", which leaves the panel with nothing but its
 * "Add relationship" button. `null` means the list was never set, so the
 * default vocabulary applies. Collapsing the two would make clearing impossible.
 */
export function serializeSuggestedRelationships(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

/** The effective keys: empty when cleared, the defaults when never set. */
export function resolveSuggestedRelationships(
  settings: SuggestedRelationshipsSettings | null | undefined,
): string[] {
  const stored = serializeSuggestedRelationships(settings?.suggested_relationships)
  if (stored === null) return [...DEFAULT_SUGGESTED_RELATIONSHIPS]
  return parseSuggestedRelationships(stored)
}

/**
 * The Settings-panel edit shape. Raw text, so a half-typed or cleared list
 * round-trips through the input untouched. Prefilled with the defaults when
 * never set, which is what makes a blank field read as a deliberate "none".
 */
export function suggestedRelationshipsDraft(
  settings: SuggestedRelationshipsSettings | null | undefined,
): string {
  return serializeSuggestedRelationships(settings?.suggested_relationships)
    ?? DEFAULT_SUGGESTED_RELATIONSHIPS_TEXT
}

export function suggestedRelationshipsFromDraft(draft: string): string[] {
  return parseSuggestedRelationships(draft)
}
