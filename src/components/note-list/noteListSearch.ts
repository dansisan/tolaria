import type { VaultEntry } from '../../types'
import type { DateDisplayFormat } from '../../utils/dateDisplay'
import type { RelationshipGroup } from '../../utils/noteListHelpers'
import { resolvePropertyChipLabels } from '../note-item/propertyChipValues'

interface NoteListSearchContext {
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  displayPropsOverride?: string[] | null
  dateDisplayFormat?: DateDisplayFormat
  fullTextResultPaths?: Set<string>
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function searchableString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function resolveDisplayProps(
  entry: VaultEntry,
  typeEntryMap: Record<string, VaultEntry>,
  displayPropsOverride?: string[] | null,
): string[] {
  if (displayPropsOverride && displayPropsOverride.length > 0) return displayPropsOverride
  return typeEntryMap[entry.isA ?? '']?.listPropertiesDisplay ?? []
}

function resolveSearchableText(entry: VaultEntry, context: NoteListSearchContext): string[] {
  return [
    searchableString(entry.title),
    searchableString(entry.snippet),
    ...resolvePropertyChipLabels(
      entry,
      resolveDisplayProps(entry, context.typeEntryMap, context.displayPropsOverride),
      {
        allEntries: context.allEntries,
        typeEntryMap: context.typeEntryMap,
        dateDisplayFormat: context.dateDisplayFormat,
      },
    ),
  ]
}

function matchesTagQuery(entry: VaultEntry, tagPrefix: string): boolean {
  if (!tagPrefix) return entry.inlineTags.length > 0
  return entry.inlineTags.some((t) => t.toLowerCase().startsWith(tagPrefix))
}

function matchesWords(texts: string[], words: string[]): boolean {
  return words.every((word) => texts.some((text) => text.toLowerCase().includes(word)))
}

export function matchesNoteListQuery(
  entry: VaultEntry,
  query: string,
  context: NoteListSearchContext,
): boolean {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return true
  if (context.fullTextResultPaths?.has(entry.path)) return true

  if (normalizedQuery.startsWith('#')) {
    const spaceIndex = normalizedQuery.indexOf(' ')
    const tagPart = spaceIndex === -1 ? normalizedQuery.slice(1) : normalizedQuery.slice(1, spaceIndex)
    if (!matchesTagQuery(entry, tagPart)) return false
    if (spaceIndex === -1) return true
    const textWords = normalizedQuery.slice(spaceIndex + 1).trim().split(/\s+/).filter(Boolean)
    return textWords.length === 0 || matchesWords(resolveSearchableText(entry, context), textWords)
  }

  const words = normalizedQuery.split(/\s+/).filter(Boolean)
  return matchesWords(resolveSearchableText(entry, context), words)
}

export function filterEntriesByNoteListQuery(
  entries: VaultEntry[],
  query: string,
  context: NoteListSearchContext,
): VaultEntry[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return entries
  return entries.filter((entry) => matchesNoteListQuery(entry, normalizedQuery, context))
}

export function filterGroupsByNoteListQuery(
  groups: RelationshipGroup[],
  query: string,
  context: NoteListSearchContext,
): RelationshipGroup[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return groups
  return groups
    .map((group) => ({
      ...group,
      entries: filterEntriesByNoteListQuery(group.entries, normalizedQuery, context),
    }))
}
