import { useCallback, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Hash } from '@phosphor-icons/react'
import type { VaultEntry } from '../types'
import type { NoteSearchResultItem } from '../components/NoteSearchList'
import { useNoteSearch, type NoteSearchResult } from './useNoteSearch'
import { buildTagCounts, type TagCount } from '../utils/tagIndex'
import { fuzzyMatch } from '../utils/fuzzyMatch'

/** Typing `#` switches quick open to tag browsing — the same prefix the note-list
 *  search already uses for tag filters, so the two surfaces stay consistent. */
export const TAG_QUERY_PREFIX = '#'
/** On a plain query tag rows trail the notes, so they stay a suggestion and can
 *  never push a note the user was aiming for out of view. */
const MAX_TAG_SUGGESTIONS = 5
const DEFAULT_MAX_RESULTS = 20

export interface QuickOpenNoteResult extends NoteSearchResult {
  kind: 'note'
}

export interface QuickOpenTagResult extends NoteSearchResultItem {
  kind: 'tag'
  tag: string
  count: number
}

export type QuickOpenResult = QuickOpenNoteResult | QuickOpenTagResult

interface TagQuery {
  tagMode: boolean
  term: string
}

interface TagResultsState {
  results: QuickOpenTagResult[]
  tagMode: boolean
}

/** exact → prefix → fuzzy. Lower sorts first. */
type TagMatchTier = 0 | 1 | 2

interface RankedTag {
  tag: TagCount
  tier: TagMatchTier
}

function parseTagQuery(query: string): TagQuery {
  const trimmed = query.trim()
  if (!trimmed.startsWith(TAG_QUERY_PREFIX)) {
    return { tagMode: false, term: trimmed.toLocaleLowerCase() }
  }
  return { tagMode: true, term: trimmed.slice(TAG_QUERY_PREFIX.length).trim().toLocaleLowerCase() }
}

function tagMatchTier(tag: string, term: string): TagMatchTier | null {
  const normalized = tag.toLocaleLowerCase()
  if (normalized === term) return 0
  if (normalized.startsWith(term)) return 1
  return fuzzyMatch(term, normalized).match ? 2 : null
}

function isRankedTag(ranked: { tag: TagCount; tier: TagMatchTier | null }): ranked is RankedTag {
  return ranked.tier !== null
}

/** `tags` arrives ordered by descending use count, so an empty term keeps that order. */
function rankTags(tags: TagCount[], term: string, limit: number): TagCount[] {
  if (term.length === 0) return tags.slice(0, limit)
  return tags
    .map((tag) => ({ tag, tier: tagMatchTier(tag.tag, term) }))
    .filter(isRankedTag)
    .sort((a, b) => a.tier - b.tier || b.tag.count - a.tag.count || a.tag.tag.localeCompare(b.tag.tag))
    .slice(0, limit)
    .map((ranked) => ranked.tag)
}

function toTagResult({ tag, count }: TagCount): QuickOpenTagResult {
  return { kind: 'tag', tag, count, title: tag, countLabel: String(count), TypeIcon: Hash }
}

/** Tags are matched off the raw query rather than the debounced one: ranking a few
 *  hundred tag strings is cheap, and tag rows only ever trail the notes, so they
 *  can't shift a note row out from under the selection while typing. */
function useTagResults(entries: VaultEntry[], query: string, maxResults: number): TagResultsState {
  const tagsByFrequency = useMemo(() => buildTagCounts(entries, 'frequency'), [entries])
  const { tagMode, term } = parseTagQuery(query)

  return useMemo(() => {
    if (tagMode) return { tagMode, results: rankTags(tagsByFrequency, term, maxResults).map(toTagResult) }
    if (term.length === 0) return { tagMode, results: [] }
    return { tagMode, results: rankTags(tagsByFrequency, term, MAX_TAG_SUGGESTIONS).map(toTagResult) }
  }, [tagsByFrequency, tagMode, term, maxResults])
}

function useQuickOpenSelection(query: string, resultCount: number) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [prevQuery, setPrevQuery] = useState(query)

  // Adjusted during render rather than in an effect, per React's guidance for
  // state that must change in the same render as the prop driving it.
  if (query !== prevQuery) {
    setPrevQuery(query)
    setSelectedIndex(0)
  }

  const handleKeyDown = useCallback((event: ReactKeyboardEvent | KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(0, Math.min(index + 1, resultCount - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => Math.max(index - 1, 0))
    }
  }, [resultCount])

  return { selectedIndex, setSelectedIndex, handleKeyDown }
}

/**
 * Quick open's result list: ranked notes, plus the vault's tags as selectable rows
 * so a tag you can't quite remember is discoverable instead of needing recall.
 */
export function useQuickOpenSearch(entries: VaultEntry[], query: string, maxResults = DEFAULT_MAX_RESULTS) {
  const noteSearch = useNoteSearch(entries, query, maxResults)
  const tags = useTagResults(entries, query, maxResults)

  const results: QuickOpenResult[] = useMemo(() => {
    if (tags.tagMode) return tags.results
    const notes = noteSearch.results.map((note): QuickOpenNoteResult => ({ kind: 'note', ...note }))
    return [...notes, ...tags.results]
  }, [noteSearch.results, tags])

  const { selectedIndex, setSelectedIndex, handleKeyDown } = useQuickOpenSelection(query, results.length)

  return {
    results,
    selected: results.at(selectedIndex) ?? null,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    tagMode: tags.tagMode,
  }
}
