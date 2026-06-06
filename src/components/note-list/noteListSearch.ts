import type { VaultEntry } from '../../types'
import type { DateDisplayFormat } from '../../utils/dateDisplay'
import type { RelationshipGroup } from '../../utils/noteListHelpers'
import { parseSearchQueryFilters, searchFilterFieldPredicate, type ParsedSearchQuery } from '../../utils/searchQueryFilters'
import { entryMatchesFilterConditions } from '../../utils/viewFilters'
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

/** Parse filter tokens against the fields known to this vault's entries. */
export function parseNoteListQuery(query: string, context: NoteListSearchContext): ParsedSearchQuery {
  return parseSearchQueryFilters(normalizeQuery(query), searchFilterFieldPredicate(context.allEntries))
}

function matchesQueryText(entry: VaultEntry, text: string, context: NoteListSearchContext): boolean {
  if (!text) return true
  if (context.fullTextResultPaths?.has(entry.path)) return true

  if (text.startsWith('#')) {
    const spaceIndex = text.indexOf(' ')
    const tagPart = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex)
    if (!matchesTagQuery(entry, tagPart)) return false
    if (spaceIndex === -1) return true
    const textWords = text.slice(spaceIndex + 1).trim().split(/\s+/).filter(Boolean)
    return textWords.length === 0 || matchesWords(resolveSearchableText(entry, context), textWords)
  }

  const words = text.split(/\s+/).filter(Boolean)
  return matchesWords(resolveSearchableText(entry, context), words)
}

export function matchesNoteListQuery(
  entry: VaultEntry,
  query: string,
  context: NoteListSearchContext,
): boolean {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return true

  const { text, conditions } = parseNoteListQuery(normalizedQuery, context)
  if (!entryMatchesFilterConditions(entry, conditions)) return false
  return matchesQueryText(entry, text, context)
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
