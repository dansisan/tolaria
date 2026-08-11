import { describe, it, expect } from 'vitest'
import { buildTagCounts, entryTags } from './tagIndex'
import type { VaultEntry } from '../types'

const makeEntry = (inlineTags: string[] | undefined): VaultEntry => ({
  inlineTags,
} as unknown as VaultEntry)

describe('buildTagCounts', () => {
  it('counts how many entries carry each tag', () => {
    const counts = buildTagCounts([
      makeEntry(['recipes', 'dinner']),
      makeEntry(['recipes']),
      makeEntry(['travel']),
    ])

    expect(counts).toEqual([
      { tag: 'dinner', count: 1 },
      { tag: 'recipes', count: 2 },
      { tag: 'travel', count: 1 },
    ])
  })

  it('orders alphabetically by default', () => {
    const counts = buildTagCounts([makeEntry(['zeta']), makeEntry(['alpha']), makeEntry(['alpha'])])
    expect(counts.map((c) => c.tag)).toEqual(['alpha', 'zeta'])
  })

  it('orders by descending count, then alphabetically, in frequency mode', () => {
    const counts = buildTagCounts([
      makeEntry(['rare']),
      makeEntry(['common', 'also-common']),
      makeEntry(['common', 'also-common']),
    ], 'frequency')

    expect(counts.map((c) => c.tag)).toEqual(['also-common', 'common', 'rare'])
  })

  it('returns an empty list when no entry carries a tag', () => {
    expect(buildTagCounts([makeEntry([]), makeEntry([])])).toEqual([])
  })

  it('tolerates entries missing inlineTags entirely', () => {
    expect(buildTagCounts([makeEntry(undefined), makeEntry(['kept'])])).toEqual([
      { tag: 'kept', count: 1 },
    ])
  })
})

describe('entryTags', () => {
  it('returns the tags when present', () => {
    expect(entryTags(makeEntry(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('returns an empty array when absent', () => {
    expect(entryTags(makeEntry(undefined))).toEqual([])
  })
})
