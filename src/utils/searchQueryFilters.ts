import type { FilterCondition, VaultEntry } from '../types'

/**
 * Structured tokens in the note-list search box, evaluated with the same
 * engine as saved-View filters:
 *
 *   created:2025            → the whole year (range)
 *   created:2025-03         → the whole month (range)
 *   created:2025-03-14      → that calendar day (equals)
 *   created:>2024-12-31     → after (also accepts relative phrases in quotes)
 *   created:<"two weeks ago" → before
 *   type:Project status:Active → equals on any built-in or frontmatter field
 *   deadline:*              → the key exists with a non-empty value
 *   deadline:""             → the key is missing or empty
 *
 * Only fields that actually exist (built-ins, frontmatter properties,
 * relationships) are treated as tokens; anything else stays plain search text,
 * so "re:invent" doesn't silently filter everything out.
 */

export interface ParsedSearchQuery {
  /** Remaining free-text words after token extraction. */
  text: string
  conditions: FilterCondition[]
}

export type SearchFilterFieldPredicate = (field: string) => boolean

const TOKEN_RE = /(^|\s)([A-Za-z_][\w-]*):([<>]?)(?:"([^"]*)"|([^\s"]+))/g
const YEAR_RE = /^\d{4}$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const BUILT_IN_SEARCH_FIELDS = new Set([
  'type', 'isa', 'status', 'title', 'filename', 'archived', 'favorite', 'body',
])

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Local wall-clock format so range edges compare in the user's timezone. */
function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `.${pad(date.getMilliseconds(), 3)}`
}

/** Strict after/before pair spanning [start, end) as local time. */
function rangeConditions(field: string, start: Date, end: Date): FilterCondition[] {
  return [
    { field, op: 'after', value: formatLocalDateTime(new Date(start.getTime() - 1)) },
    { field, op: 'before', value: formatLocalDateTime(end) },
  ]
}

function shorthandDateConditions(field: string, value: string): FilterCondition[] | null {
  if (YEAR_RE.test(value)) {
    const year = Number(value)
    return rangeConditions(field, new Date(year, 0, 1), new Date(year + 1, 0, 1))
  }
  if (MONTH_RE.test(value)) {
    const [year, month] = value.split('-').map(Number)
    return rangeConditions(field, new Date(year, month - 1, 1), new Date(year, month, 1))
  }
  return null
}

function tokenConditions(options: {
  field: string
  operator: string
  value: string
  quoted: boolean
}): FilterCondition[] {
  const { field, operator, value, quoted } = options
  if (operator === '>') return [{ field, op: 'after', value }]
  if (operator === '<') return [{ field, op: 'before', value }]
  if (quoted && value === '') return [{ field, op: 'is_empty' }]
  if (quoted) return [{ field, op: 'equals', value }]
  if (value === '*') return [{ field, op: 'is_not_empty' }]
  return shorthandDateConditions(field, value) ?? [{ field, op: 'equals', value }]
}

/** Split a search query into filter conditions and remaining free text. */
export function parseSearchQueryFilters(
  query: string,
  isKnownField: SearchFilterFieldPredicate = () => true,
): ParsedSearchQuery {
  const conditions: FilterCondition[] = []
  const text = query.replace(
    TOKEN_RE,
    (match, leading: string, field: string, operator: string, quotedValue: string | undefined, bareValue: string | undefined) => {
      // "https://…" is a URL being typed into search, not a filter token.
      if (quotedValue === undefined && bareValue?.startsWith('//')) return match
      if (!isKnownField(field.toLowerCase())) return match
      conditions.push(...tokenConditions({
        field,
        operator,
        value: quotedValue ?? bareValue ?? '',
        quoted: quotedValue !== undefined,
      }))
      return leading
    },
  )

  return { text: text.replace(/\s+/g, ' ').trim(), conditions }
}

const knownFieldsCache = new WeakMap<VaultEntry[], Set<string>>()

function collectKnownFields(entries: VaultEntry[]): Set<string> {
  const fields = new Set(BUILT_IN_SEARCH_FIELDS)
  for (const entry of entries) {
    for (const key of Object.keys(entry.properties)) fields.add(key.toLowerCase())
    for (const key of Object.keys(entry.relationships)) fields.add(key.toLowerCase())
  }
  return fields
}

/** Predicate over the fields actually present in the vault (memoized per entry list). */
export function searchFilterFieldPredicate(entries: VaultEntry[]): SearchFilterFieldPredicate {
  let known = knownFieldsCache.get(entries)
  if (!known) {
    known = collectKnownFields(entries)
    knownFieldsCache.set(entries, known)
  }
  return (field) => known.has(field)
}
