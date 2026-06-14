import { describe, expect, it } from 'vitest'
import {
  buildPeopleDialogRows,
  buildPeopleMentions,
  expandPersonSearchValue,
  filterPeople,
  firstPersonRowIndex,
  movePersonSelection,
  peopleSearchToken,
  sortPeopleByCount,
  type PersonMention,
} from './peopleMentions'
import type { VaultEntry } from '../types'

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/v/test.md', filename: 'test.md', title: 'Test', isA: null,
    aliases: [], belongsTo: [], relatedTo: [], status: null,
    archived: false, inlineTags: [],
    modifiedAt: 0, createdAt: 0, fileSize: 0, snippet: '',
    wordCount: 0, relationships: {}, icon: null, color: null,
    order: null, sidebarLabel: null, template: null, sort: null, view: null,
    visible: null, favorite: false, favoriteIndex: null,
    outgoingLinks: [], properties: {}, listPropertiesDisplay: [],
    ...overrides,
  }
}

const MATTEO = makeEntry({ path: '/v/person-matteo.md', filename: 'person-matteo.md', title: 'Matteo Cellini', isA: 'Person' })

describe('buildPeopleMentions', () => {
  it('counts the people field across notes (relationship wikilinks)', () => {
    const notes = [
      MATTEO,
      makeEntry({ path: '/v/n1.md', relationships: { people: ['[[person-matteo]]', '[[bob]]'] } }),
      makeEntry({ path: '/v/n2.md', relationships: { people: ['[[person-matteo]]'] } }),
    ]
    const result = buildPeopleMentions(notes)
    expect(result).toContainEqual({ name: 'Matteo Cellini', query: 'Matteo Cellini', count: 2 })
    expect(result).toContainEqual({ name: 'bob', query: 'bob', count: 1 })
  })

  it('merges name variants that are aliases of one note', () => {
    const harold = makeEntry({ path: '/v/harold.md', filename: 'harold.md', title: 'Harold', isA: 'Person', aliases: ['H', 'H.'] })
    const notes = [
      harold,
      makeEntry({ path: '/v/n1.md', properties: { people: ['H'] } }),
      makeEntry({ path: '/v/n2.md', properties: { people: ['H.'] } }),
      makeEntry({ path: '/v/n3.md', properties: { people: ['Harold'] } }),
    ]
    expect(buildPeopleMentions(notes)).toEqual([{ name: 'Harold', query: 'Harold', count: 3 }])
  })

  it('reads a plain-string property people field', () => {
    const notes = [makeEntry({ path: '/v/n1.md', properties: { people: ['Alice', 'Bob'] } })]
    expect(buildPeopleMentions(notes).map((p) => p.name)).toEqual(['Alice', 'Bob'])
  })

  it('resolves a wikilink target to the linked note title for display', () => {
    const notes = [MATTEO, makeEntry({ path: '/v/n1.md', relationships: { people: ['[[person-matteo]]'] } })]
    expect(buildPeopleMentions(notes)[0].name).toBe('Matteo Cellini')
  })

  it('uses the alias label when a piped wikilink has no resolvable note', () => {
    const notes = [makeEntry({ path: '/v/n1.md', relationships: { people: ['[[p-x|Dr. X]]'] } })]
    expect(buildPeopleMentions(notes)[0]).toEqual({ name: 'Dr. X', query: 'p-x', count: 1 })
  })

  it('counts a person once per note even if listed twice', () => {
    const notes = [makeEntry({ path: '/v/n1.md', properties: { people: ['Alice', 'Alice'] } })]
    expect(buildPeopleMentions(notes)[0].count).toBe(1)
  })

  it('is case-insensitive about the field name and returns empty when absent', () => {
    const upper = makeEntry({ path: '/v/n1.md', relationships: { People: ['[[bob]]'] } })
    expect(buildPeopleMentions([upper])[0].name).toBe('bob')
    expect(buildPeopleMentions([makeEntry({ properties: { topic: ['x'] } })])).toEqual([])
  })

  it('sorts people alphabetically by display name', () => {
    const notes = [makeEntry({ path: '/v/n1.md', properties: { people: ['Zara', 'Alice'] } })]
    expect(buildPeopleMentions(notes).map((p) => p.name)).toEqual(['Alice', 'Zara'])
  })
})

describe('expandPersonSearchValue', () => {
  const harold = makeEntry({ path: '/v/harold.md', filename: 'harold.md', title: 'Harold', aliases: ['H', 'H.'] })

  it('expands a value to every identity of the resolved note', () => {
    expect(expandPersonSearchValue('H', [harold])?.slice().sort()).toEqual(['h', 'h.', 'harold'])
  })

  it('returns null for unresolved values', () => {
    expect(expandPersonSearchValue('nobody', [harold])).toBeNull()
  })

  it('returns null when the note has nothing to merge', () => {
    const solo = makeEntry({ path: '/v/solo.md', filename: 'solo.md', title: 'solo' })
    expect(expandPersonSearchValue('solo', [solo])).toBeNull()
  })
})

describe('peopleSearchToken', () => {
  it('builds a bare token for single-word values', () => {
    expect(peopleSearchToken('person-matteo')).toBe('people:person-matteo')
  })

  it('quotes values that contain spaces', () => {
    expect(peopleSearchToken('Matteo Cellini')).toBe('people:"Matteo Cellini"')
  })
})

function person(name: string, count: number): PersonMention {
  return { name, query: name.toLowerCase().replace(/\s+/g, '-'), count }
}

const PEOPLE = [person('Alice', 2), person('Bob', 9), person('Carol', 5)]

describe('sortPeopleByCount', () => {
  it('orders by count descending, then name', () => {
    expect(sortPeopleByCount(PEOPLE).map((p) => p.name)).toEqual(['Bob', 'Carol', 'Alice'])
  })

  it('does not mutate the input', () => {
    const input = [...PEOPLE]
    sortPeopleByCount(input)
    expect(input.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Carol'])
  })
})

describe('filterPeople', () => {
  it('matches name or query case-insensitively', () => {
    expect(filterPeople(PEOPLE, 'bo').map((p) => p.name)).toEqual(['Bob'])
  })

  it('returns all when the query is blank', () => {
    expect(filterPeople(PEOPLE, '  ')).toHaveLength(3)
  })
})

describe('buildPeopleDialogRows', () => {
  const many = Array.from({ length: 12 }, (_, i) => person(`P${String(i).padStart(2, '0')}`, i))

  it('shows a top section above the alphabetical list when above the threshold', () => {
    const rows = buildPeopleDialogRows(many, { query: '', sort: 'name', topCount: 3 })
    const headers = rows.filter((r) => r.kind === 'header')
    expect(headers.map((h) => h.kind === 'header' && h.label)).toEqual(['top', 'all'])
    const topPeople = rows.filter((r) => r.id.startsWith('top:'))
    expect(topPeople).toHaveLength(3)
    // Highest counts first in the top section.
    expect(topPeople[0].kind === 'person' && topPeople[0].person.name).toBe('P11')
  })

  it('omits the redundant top section when sorted by count', () => {
    const rows = buildPeopleDialogRows(many, { query: '', sort: 'count', topCount: 3 })
    expect(rows.filter((r) => r.kind === 'header').map((h) => h.kind === 'header' && h.label)).toEqual(['all'])
  })

  it('omits the top section when at or below the threshold', () => {
    const rows = buildPeopleDialogRows(PEOPLE, { query: '', sort: 'name', topCount: 10 })
    expect(rows.filter((r) => r.kind === 'header').map((h) => h.kind === 'header' && h.label)).toEqual(['all'])
  })

  it('returns a single results section when searching', () => {
    const rows = buildPeopleDialogRows(PEOPLE, { query: 'a', sort: 'count', topCount: 3 })
    const headers = rows.filter((r) => r.kind === 'header')
    expect(headers).toHaveLength(1)
    expect(headers[0].kind === 'header' && headers[0].label).toBe('results')
    expect(rows.filter((r) => r.kind === 'person').map((r) => r.kind === 'person' && r.person.name)).toEqual(['Carol', 'Alice'])
  })

  it('navigates person rows with the keyboard, skipping headers', () => {
    // [header 'all', Bob, Carol, Alice] → person rows at flat indexes 1,2,3
    const rows = buildPeopleDialogRows(PEOPLE, { query: '', sort: 'count', topCount: 10 })
    expect(firstPersonRowIndex(rows)).toBe(1)
    expect(movePersonSelection(rows, null, 'down')).toBe(1)
    expect(movePersonSelection(rows, 1, 'down')).toBe(2)
    expect(movePersonSelection(rows, 3, 'down')).toBe(3) // clamps at last
    expect(movePersonSelection(rows, 2, 'up')).toBe(1)
    expect(movePersonSelection(rows, 1, 'up')).toBeNull() // back to search box
    expect(movePersonSelection([], null, 'down')).toBeNull()
  })

  it('orders the all-people section by the active sort', () => {
    const byName = buildPeopleDialogRows(PEOPLE, { query: '', sort: 'name', topCount: 10 })
      .filter((r) => r.kind === 'person').map((r) => r.kind === 'person' && r.person.name)
    expect(byName).toEqual(['Alice', 'Bob', 'Carol'])
    const byCount = buildPeopleDialogRows(PEOPLE, { query: '', sort: 'count', topCount: 10 })
      .filter((r) => r.kind === 'person').map((r) => r.kind === 'person' && r.person.name)
    expect(byCount).toEqual(['Bob', 'Carol', 'Alice'])
  })
})
