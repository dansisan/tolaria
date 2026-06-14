import type { VaultEntry } from '../types'

/** Frontmatter field that lists the people a note is about. */
const PEOPLE_FIELD = 'people'

export interface PersonMention {
  /** Friendly display name (resolved note title when possible). */
  name: string
  /** Raw value used to build the `people:` search token (a wikilink target or plain name). */
  query: string
  /** Number of notes whose `people` field includes this person. */
  count: number
}

function caseInsensitiveGet(record: Record<string, unknown>, key: string): unknown {
  const match = Object.keys(record).find((k) => k.toLowerCase() === key)
  return match ? Reflect.get(record, match) : undefined
}

/** Read the `people` field of an entry as a list of raw values (relationship or property). */
function peopleFieldValues(entry: VaultEntry): string[] {
  const relationship = caseInsensitiveGet(entry.relationships, PEOPLE_FIELD)
  if (Array.isArray(relationship)) return relationship.map(String)
  const property = caseInsensitiveGet(entry.properties, PEOPLE_FIELD)
  if (Array.isArray(property)) return property.map(String)
  if (property != null && property !== '') return [String(property)]
  return []
}

interface ParsedPerson {
  /** Wikilink target (or plain value); the stable identity used for the search token. */
  target: string
  /** Human label: the alias after `|`, or the target itself. */
  label: string
}

/** Strip `[[ ]]` and split an optional `target|label` alias. */
function parsePersonValue(raw: string): ParsedPerson {
  const inner = raw.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
  const pipe = inner.indexOf('|')
  if (pipe >= 0) return { target: inner.slice(0, pipe).trim(), label: inner.slice(pipe + 1).trim() }
  return { target: inner, label: inner }
}

/** Every string a `people` value might use to point at this entry (slug, title, aliases). */
function entryIdentities(entry: VaultEntry): string[] {
  const slug = entry.filename.replace(/\.md$/i, '')
  const ids = [slug, entry.title, ...entry.aliases].map((id) => parsePersonValue(id).target.toLowerCase())
  return Array.from(new Set(ids.filter(Boolean)))
}

/**
 * Map every identity (slug, title, alias) to its note, so name variants that
 * are aliases of one note resolve — and therefore merge — together.
 */
function buildEntryResolver(entries: VaultEntry[]): Map<string, VaultEntry> {
  const resolver = new Map<string, VaultEntry>()
  for (const entry of entries) {
    for (const key of entryIdentities(entry)) {
      if (!resolver.has(key)) resolver.set(key, entry)
    }
  }
  return resolver
}

const entryResolverCache = new WeakMap<VaultEntry[], Map<string, VaultEntry>>()

function getEntryResolver(entries: VaultEntry[]): Map<string, VaultEntry> {
  const cached = entryResolverCache.get(entries)
  if (cached) return cached
  const built = buildEntryResolver(entries)
  entryResolverCache.set(entries, built)
  return built
}

/** Group key + display for a raw value: the resolved note when known, else the raw value. */
function resolvePersonMeta(
  raw: string,
  resolver: Map<string, VaultEntry>,
): { key: string; name: string; query: string; resolvedPath: string | null } | null {
  const { target, label } = parsePersonValue(raw)
  if (!target) return null
  const resolved = resolver.get(target.toLowerCase())
  if (resolved) return { key: `note:${resolved.path}`, name: resolved.title, query: resolved.title, resolvedPath: resolved.path }
  return { key: `raw:${target.toLowerCase()}`, name: label || target, query: target, resolvedPath: null }
}

/** Aggregate people listed in the `people` field across entries, sorted by name. */
export function buildPeopleMentions(entries: VaultEntry[]): PersonMention[] {
  const resolver = getEntryResolver(entries)
  const counts = new Map<string, number>()
  const meta = new Map<string, { name: string; query: string }>()

  for (const entry of entries) {
    const keys = new Set<string>()
    for (const raw of peopleFieldValues(entry)) {
      const resolved = resolvePersonMeta(raw, resolver)
      if (!resolved || resolved.resolvedPath === entry.path) continue
      keys.add(resolved.key)
      if (!meta.has(resolved.key)) meta.set(resolved.key, { name: resolved.name, query: resolved.query })
    }
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const entryMeta = meta.get(key) ?? { name: key, query: key }
      return { name: entryMeta.name, query: entryMeta.query, count }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Build the note-list search token that filters to notes listing this person. */
export function peopleSearchToken(query: string): string {
  return query.includes(' ') ? `${PEOPLE_FIELD}:"${query}"` : `${PEOPLE_FIELD}:${query}`
}

/**
 * Expand a `people:` search value to every identity of the note it resolves to,
 * so searching one name variant matches notes that used any merged variant.
 * Returns null when the value resolves to nothing (keep the literal match).
 */
export function expandPersonSearchValue(value: string, entries: VaultEntry[]): string[] | null {
  const entry = getEntryResolver(entries).get(value.trim().toLowerCase())
  if (!entry) return null
  const identities = entryIdentities(entry)
  return identities.length > 1 ? identities : null
}

/** Most-mentioned first, breaking ties alphabetically. */
export function sortPeopleByCount(people: PersonMention[]): PersonMention[] {
  return [...people].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Case-insensitive substring match on display name or raw query value. */
export function filterPeople(people: PersonMention[], query: string): PersonMention[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return people
  return people.filter(
    (p) => p.name.toLowerCase().includes(normalized) || p.query.toLowerCase().includes(normalized),
  )
}

export type PeopleDialogRow =
  | { kind: 'header'; id: string; label: 'top' | 'all' | 'results'; count: number }
  | { kind: 'person'; id: string; person: PersonMention }

interface PeopleDialogOptions {
  query: string
  sort: 'count' | 'name'
  topCount: number
}

function personRow(person: PersonMention, section: string): PeopleDialogRow {
  return { kind: 'person', id: `${section}:${person.query}`, person }
}

/**
 * Flatten people into virtualizable rows. When searching, a single "results"
 * section. Otherwise the full "all people" list in the active sort, preceded by
 * a "top mentioned" preview only when alphabetical sort would otherwise scatter
 * the most-mentioned people (it's redundant when already sorted by count).
 */
export function buildPeopleDialogRows(
  people: PersonMention[],
  { query, sort, topCount }: PeopleDialogOptions,
): PeopleDialogRow[] {
  const ordered = sort === 'count' ? sortPeopleByCount(people) : people
  const filtered = filterPeople(ordered, query)

  if (query.trim()) {
    return [
      { kind: 'header', id: 'results', label: 'results', count: filtered.length },
      ...filtered.map((p) => personRow(p, 'results')),
    ]
  }

  const rows: PeopleDialogRow[] = []
  if (sort === 'name' && people.length > topCount) {
    const top = sortPeopleByCount(people).slice(0, topCount)
    rows.push({ kind: 'header', id: 'top', label: 'top', count: top.length })
    rows.push(...top.map((p) => personRow(p, 'top')))
  }
  rows.push({ kind: 'header', id: 'all', label: 'all', count: ordered.length })
  rows.push(...ordered.map((p) => personRow(p, 'all')))
  return rows
}
