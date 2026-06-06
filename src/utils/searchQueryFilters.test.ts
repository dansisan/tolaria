import { describe, expect, it } from 'vitest'
import { parseSearchQueryFilters, searchFilterFieldPredicate } from './searchQueryFilters'
import { entryMatchesFilterConditions } from './viewFilters'
import type { VaultEntry } from '../types'

const NOW = Math.floor(Date.now() / 1000)

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/test.md', filename: 'test.md', title: 'Test', isA: null,
    aliases: [], belongsTo: [], relatedTo: [], status: null,
    archived: false,
    modifiedAt: NOW, createdAt: NOW, fileSize: 100, snippet: '',
    wordCount: 0, relationships: {}, icon: null, color: null,
    order: null, sidebarLabel: null, template: null, sort: null, view: null,
    visible: null, favorite: false, favoriteIndex: null,
    outgoingLinks: [], properties: {}, listPropertiesDisplay: [],
    ...overrides,
  }
}

describe('parseSearchQueryFilters', () => {
  it('leaves plain text queries untouched', () => {
    expect(parseSearchQueryFilters('guitar practice')).toEqual({
      text: 'guitar practice',
      conditions: [],
    })
  })

  it('extracts an equals token and keeps remaining text', () => {
    const { text, conditions } = parseSearchQueryFilters('guitar type:project')
    expect(text).toBe('guitar')
    expect(conditions).toEqual([{ field: 'type', op: 'equals', value: 'project' }])
  })

  it('expands a year into a local range', () => {
    const { text, conditions } = parseSearchQueryFilters('created:2025')
    expect(text).toBe('')
    expect(conditions).toEqual([
      { field: 'created', op: 'after', value: '2024-12-31T23:59:59.999' },
      { field: 'created', op: 'before', value: '2026-01-01T00:00:00.000' },
    ])
  })

  it('expands a month into a local range', () => {
    const { conditions } = parseSearchQueryFilters('created:2025-03')
    expect(conditions).toEqual([
      { field: 'created', op: 'after', value: '2025-02-28T23:59:59.999' },
      { field: 'created', op: 'before', value: '2025-04-01T00:00:00.000' },
    ])
  })

  it('keeps a full date as a same-day equals', () => {
    expect(parseSearchQueryFilters('created:2025-03-14').conditions)
      .toEqual([{ field: 'created', op: 'equals', value: '2025-03-14' }])
  })

  it('maps > and < to after/before', () => {
    expect(parseSearchQueryFilters('created:>2024-12-31').conditions)
      .toEqual([{ field: 'created', op: 'after', value: '2024-12-31' }])
    expect(parseSearchQueryFilters('created:<"two weeks ago"').conditions)
      .toEqual([{ field: 'created', op: 'before', value: 'two weeks ago' }])
  })

  it('treats quoted values as literal equals (no shorthand expansion)', () => {
    expect(parseSearchQueryFilters('priority:"2025"').conditions)
      .toEqual([{ field: 'priority', op: 'equals', value: '2025' }])
    expect(parseSearchQueryFilters('tags:"deep work"').conditions)
      .toEqual([{ field: 'tags', op: 'equals', value: 'deep work' }])
  })

  it('extracts multiple tokens', () => {
    const { text, conditions } = parseSearchQueryFilters('type:project status:active review')
    expect(text).toBe('review')
    expect(conditions.map((c) => c.field)).toEqual(['type', 'status'])
  })

  it('leaves unknown fields as plain text', () => {
    const known = (field: string) => field === 'created'
    expect(parseSearchQueryFilters('re:invent created:2025', known).text).toBe('re:invent')
  })

  it('does not treat tag queries or urls as tokens', () => {
    expect(parseSearchQueryFilters('#guitar').conditions).toEqual([])
    expect(parseSearchQueryFilters('https://example.com').text).toBe('https://example.com')
  })
})

describe('searchFilterFieldPredicate', () => {
  it('accepts built-ins, properties, and relationships from entries', () => {
    const entries = [makeEntry({
      properties: { Created: '2025-01-01', priority: 2 },
      relationships: { belongs_to: ['[[x]]'] },
    })]
    const isKnown = searchFilterFieldPredicate(entries)
    expect(isKnown('type')).toBe(true)
    expect(isKnown('created')).toBe(true)
    expect(isKnown('priority')).toBe(true)
    expect(isKnown('belongs_to')).toBe(true)
    expect(isKnown('re')).toBe(false)
  })

  it('memoizes per entry list', () => {
    const entries = [makeEntry({})]
    expect(searchFilterFieldPredicate(entries)('type'))
      .toBe(searchFilterFieldPredicate(entries)('type'))
  })
})

describe('end to end with the view filter engine', () => {
  const notes = [
    makeEntry({ title: 'Old', properties: { created: '2024-06-15 09:00:00' } }),
    makeEntry({ title: 'In 2025', properties: { created: '2025-03-14 10:30:00' } }),
    makeEntry({ title: 'Midnight Jan 1', properties: { created: '2025-01-01 00:00:00' } }),
    makeEntry({ title: 'Next year', properties: { created: '2026-01-01 00:00:00' } }),
  ]

  it('created:2025 matches only notes from 2025, inclusive of Jan 1 midnight', () => {
    const { conditions } = parseSearchQueryFilters('created:2025')
    const matched = notes.filter((entry) => entryMatchesFilterConditions(entry, conditions))
    expect(matched.map((e) => e.title)).toEqual(['In 2025', 'Midnight Jan 1'])
  })

  it('created:2025-03 matches only March notes', () => {
    const { conditions } = parseSearchQueryFilters('created:2025-03')
    const matched = notes.filter((entry) => entryMatchesFilterConditions(entry, conditions))
    expect(matched.map((e) => e.title)).toEqual(['In 2025'])
  })

  it('compares numeric properties with > and <', () => {
    const rated = [
      makeEntry({ title: 'Three', properties: { rating: 3 } }),
      makeEntry({ title: 'Five', properties: { rating: 5 } }),
      makeEntry({ title: 'Stringy four', properties: { rating: '4' } }),
    ]
    const { conditions } = parseSearchQueryFilters('rating:>3')
    const matched = rated.filter((entry) => entryMatchesFilterConditions(entry, conditions))
    expect(matched.map((e) => e.title)).toEqual(['Five', 'Stringy four'])
  })
})
