import { describe, expect, it } from 'vitest'
import { filterEntriesByNoteListQuery, matchesNoteListQuery } from './noteListSearch'
import type { VaultEntry } from '../../types'

const NOW = Math.floor(Date.now() / 1000)

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/test.md', filename: 'test.md', title: 'Test', isA: null,
    aliases: [], belongsTo: [], relatedTo: [], status: null,
    archived: false, inlineTags: [],
    modifiedAt: NOW, createdAt: NOW, fileSize: 100, snippet: '',
    wordCount: 0, relationships: {}, icon: null, color: null,
    order: null, sidebarLabel: null, template: null, sort: null, view: null,
    visible: null, favorite: false, favoriteIndex: null,
    outgoingLinks: [], properties: {}, listPropertiesDisplay: [],
    ...overrides,
  }
}

const NOTES = [
  makeEntry({ path: '/v/a.md', title: 'Guitar practice', properties: { created: '2025-03-14 10:30:00' } }),
  makeEntry({ path: '/v/b.md', title: 'Guitar shopping', properties: { created: '2024-06-01 08:00:00' } }),
  makeEntry({ path: '/v/c.md', title: 'Taxes', properties: { created: '2025-07-04 12:00:00' } }),
]

function context(overrides: Record<string, unknown> = {}) {
  return { allEntries: NOTES, typeEntryMap: {}, ...overrides }
}

describe('note list query filter tokens', () => {
  it('filters by created year', () => {
    const result = filterEntriesByNoteListQuery(NOTES, 'created:2025', context())
    expect(result.map((e) => e.title)).toEqual(['Guitar practice', 'Taxes'])
  })

  it('combines tokens with free text', () => {
    const result = filterEntriesByNoteListQuery(NOTES, 'guitar created:2025', context())
    expect(result.map((e) => e.title)).toEqual(['Guitar practice'])
  })

  it('applies tokens even when a full-text hit would bypass text matching', () => {
    const fullTextResultPaths = new Set(['/v/b.md'])
    expect(matchesNoteListQuery(NOTES[1], 'guitar created:2025', context({ fullTextResultPaths })))
      .toBe(false)
    expect(matchesNoteListQuery(NOTES[1], 'guitar', context({ fullTextResultPaths })))
      .toBe(true)
  })

  it('treats unknown fields as plain text', () => {
    const result = filterEntriesByNoteListQuery(NOTES, 'guitar re:invent', context())
    expect(result).toEqual([])
  })

  it('keeps tag queries working alongside tokens', () => {
    const tagged = makeEntry({ path: '/v/t.md', title: 'Riffs', inlineTags: ['guitar'], properties: { created: '2025-02-02' } })
    const all = [...NOTES, tagged]
    const result = filterEntriesByNoteListQuery(all, '#guitar created:2025', { allEntries: all, typeEntryMap: {} })
    expect(result.map((e) => e.title)).toEqual(['Riffs'])
  })
})
