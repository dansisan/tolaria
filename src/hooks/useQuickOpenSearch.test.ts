import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQuickOpenSearch } from './useQuickOpenSearch'
import type { VaultEntry } from '../types'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  inlineTags: [],
  modifiedAt: 1700000000,
  ...overrides,
} as unknown as VaultEntry)

const entries: VaultEntry[] = [
  makeEntry({ path: '/vault/a.md', title: 'Alpha Project', inlineTags: ['work', 'urgent'], modifiedAt: 1700000003 }),
  makeEntry({ path: '/vault/b.md', title: 'Beta Notes', inlineTags: ['work'], modifiedAt: 1700000002 }),
  makeEntry({ path: '/vault/c.md', title: 'Gamma Experiment', inlineTags: ['recipes'], modifiedAt: 1700000001 }),
]

const kinds = (results: { kind: string }[]) => results.map((r) => r.kind)
const titles = (results: { title: string }[]) => results.map((r) => r.title)

describe('useQuickOpenSearch', () => {
  describe('tag browsing mode', () => {
    it('lists every tag by descending use count for a bare # query', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#'))
      expect(result.current.results).toEqual([
        expect.objectContaining({ kind: 'tag', tag: 'work', count: 2 }),
        expect.objectContaining({ kind: 'tag', tag: 'recipes', count: 1 }),
        expect.objectContaining({ kind: 'tag', tag: 'urgent', count: 1 }),
      ])
    })

    it('suppresses note results entirely in tag mode', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#work'))
      expect(kinds(result.current.results)).toEqual(['tag'])
    })

    it('narrows tags by prefix after the #', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#rec'))
      expect(result.current.results).toEqual([
        expect.objectContaining({ tag: 'recipes' }),
      ])
    })

    it('does not let a slugified # query leak note matches', () => {
      const withNote = [...entries, makeEntry({ path: '/vault/w.md', title: 'Work' })]
      const { result } = renderHook(() => useQuickOpenSearch(withNote, '#work'))
      expect(kinds(result.current.results)).toEqual(['tag'])
    })

    it('returns nothing for a # query matching no tag', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#zzzz'))
      expect(result.current.results).toEqual([])
    })

    it('presents a tag row with the tag name as its title and the count as a badge', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#work'))
      const [row] = result.current.results
      expect(row).toEqual(expect.objectContaining({ title: 'work', countLabel: '2' }))
      expect(row.TypeIcon).toBeDefined()
    })
  })

  describe('plain queries', () => {
    it('returns notes first, then matching tags', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, 'work'))
      expect(kinds(result.current.results)).toEqual(['note', 'note', 'tag'])
      expect(titles(result.current.results)).toEqual(['Alpha Project', 'Beta Notes', 'work'])
    })

    it('offers no tag rows for an empty query', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, ''))
      expect(kinds(result.current.results)).toEqual(['note', 'note', 'note'])
    })

    it('caps tag suggestions so they cannot crowd out notes', () => {
      const manyTags = Array.from({ length: 9 }, (_, i) => makeEntry({
        path: `/vault/t${i}.md`,
        title: `Tagged ${i}`,
        inlineTags: [`topic-${i}`],
      }))
      const { result } = renderHook(() => useQuickOpenSearch(manyTags, 'topic'))
      expect(result.current.results.filter((r) => r.kind === 'tag')).toHaveLength(5)
    })
  })

  it('reports tag mode so callers can suppress note-only affordances', () => {
    const { result: tagMode } = renderHook(() => useQuickOpenSearch(entries, '#zzzz'))
    expect(tagMode.current.tagMode).toBe(true)

    const { result: plain } = renderHook(() => useQuickOpenSearch(entries, 'zzzz'))
    expect(plain.current.tagMode).toBe(false)
  })

  describe('selection', () => {
    it('starts at the first row and resets when the query changes', () => {
      const { result, rerender } = renderHook(
        ({ query }) => useQuickOpenSearch(entries, query),
        { initialProps: { query: '#' } },
      )
      expect(result.current.selectedIndex).toBe(0)

      act(() => { result.current.setSelectedIndex(2) })
      expect(result.current.selectedIndex).toBe(2)

      rerender({ query: '#w' })
      expect(result.current.selectedIndex).toBe(0)
    })

    it('clamps arrow-key movement to the merged result list', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#'))

      act(() => { result.current.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' })) })
      expect(result.current.selectedIndex).toBe(0)

      for (let i = 0; i < 5; i++) {
        act(() => { result.current.handleKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' })) })
      }
      expect(result.current.selectedIndex).toBe(2)
    })

    it('exposes the selected row', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#'))
      expect(result.current.selected).toEqual(expect.objectContaining({ kind: 'tag', tag: 'work' }))
    })

    it('exposes a null selection when there are no results', () => {
      const { result } = renderHook(() => useQuickOpenSearch(entries, '#zzzz'))
      expect(result.current.selected).toBeNull()
    })
  })
})
