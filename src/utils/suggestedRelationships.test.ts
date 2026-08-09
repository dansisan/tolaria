import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUGGESTED_RELATIONSHIPS,
  DEFAULT_SUGGESTED_RELATIONSHIPS_TEXT,
  includesRelationshipKey,
  resolveSuggestedRelationships,
  serializeSuggestedRelationships,
  suggestedRelationshipsDraft,
  suggestedRelationshipsFromDraft,
} from './suggestedRelationships'

describe('resolveSuggestedRelationships', () => {
  it('falls back to the built-in vocabulary when the setting was never set', () => {
    expect(resolveSuggestedRelationships({ suggested_relationships: null }))
      .toEqual([...DEFAULT_SUGGESTED_RELATIONSHIPS])
    expect(resolveSuggestedRelationships(undefined)).toEqual([...DEFAULT_SUGGESTED_RELATIONSHIPS])
  })

  it('resolves a cleared list to no relationships at all', () => {
    expect(resolveSuggestedRelationships({ suggested_relationships: '' })).toEqual([])
    expect(resolveSuggestedRelationships({ suggested_relationships: '   ' })).toEqual([])
    expect(resolveSuggestedRelationships({ suggested_relationships: ' , , ' })).toEqual([])
  })

  it('parses a comma-separated list, keeping the authored spelling and order', () => {
    expect(resolveSuggestedRelationships({ suggested_relationships: 'Depends on, has_part' }))
      .toEqual(['Depends on', 'has_part'])
  })

  it('parses newline-separated lists so a pasted block works too', () => {
    expect(resolveSuggestedRelationships({ suggested_relationships: 'has_part\nblocked_by' }))
      .toEqual(['has_part', 'blocked_by'])
  })

  it('drops duplicates that differ only by case or separator', () => {
    expect(resolveSuggestedRelationships({ suggested_relationships: 'belongs_to, Belongs To, belongs-to' }))
      .toEqual(['belongs_to'])
  })
})

describe('serializeSuggestedRelationships', () => {
  it('keeps the empty string, because a cleared list is a deliberate "none"', () => {
    expect(serializeSuggestedRelationships('   ')).toBe('')
  })

  it('reports a never-set list as null so the default can apply', () => {
    expect(serializeSuggestedRelationships(null)).toBeNull()
    expect(serializeSuggestedRelationships(undefined)).toBeNull()
  })
})

describe('includesRelationshipKey', () => {
  const keys = ['belongs_to', 'Depends on']

  it('matches past case and separators', () => {
    expect(includesRelationshipKey(keys, 'Belongs To')).toBe(true)
    expect(includesRelationshipKey(keys, 'belongs-to')).toBe(true)
    expect(includesRelationshipKey(keys, 'depends_on')).toBe(true)
  })

  it('rejects keys outside the configured vocabulary', () => {
    expect(includesRelationshipKey(keys, 'has')).toBe(false)
    expect(includesRelationshipKey([], 'belongs_to')).toBe(false)
  })
})

describe('suggested relationships draft', () => {
  it('prefills the defaults when never set, so a blank field means none', () => {
    expect(suggestedRelationshipsDraft({ suggested_relationships: null }))
      .toBe(DEFAULT_SUGGESTED_RELATIONSHIPS_TEXT)
  })

  it('round-trips a cleared list as a blank field', () => {
    expect(suggestedRelationshipsDraft({ suggested_relationships: '' })).toBe('')
    expect(suggestedRelationshipsFromDraft('')).toEqual([])
  })

  it('round-trips a configured list', () => {
    expect(suggestedRelationshipsDraft({ suggested_relationships: 'has_part, blocked_by' }))
      .toBe('has_part, blocked_by')
    expect(suggestedRelationshipsFromDraft('has_part, blocked_by')).toEqual(['has_part', 'blocked_by'])
  })
})
