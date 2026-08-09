import { describe, expect, it } from 'vitest'
import {
  ALIASES_PROPERTY_KEY,
  DEFAULT_SUGGESTED_PROPERTIES_TEXT,
  offersAliasesProperty,
  resolveSuggestedProperties,
  serializeSuggestedProperties,
  serializeSuggestedPropertiesDraft,
  suggestedPropertiesDraft,
  suggestedPropertiesFromDraft,
} from './suggestedProperties'

describe('resolveSuggestedProperties', () => {
  it('offers Status, Date, URL, Icon and Aliases when the setting was never set', () => {
    expect(resolveSuggestedProperties({ suggested_properties: null }).map((p) => p.label))
      .toEqual(['Status', 'Date', 'URL', 'Icon', 'Aliases'])
    expect(DEFAULT_SUGGESTED_PROPERTIES_TEXT).toBe('Status, Date, URL, Icon, Aliases')
  })

  it('resolves a cleared list to no properties at all', () => {
    expect(resolveSuggestedProperties({ suggested_properties: '' })).toEqual([])
    expect(resolveSuggestedProperties({ suggested_properties: '  ,  ' })).toEqual([])
  })

  it('keeps the built-in write key and editor however the key was typed', () => {
    expect(resolveSuggestedProperties({ suggested_properties: 'Icon, url' }))
      .toEqual([
        { key: 'icon', label: 'Icon', mode: 'text' },
        { key: 'URL', label: 'URL', mode: 'url' },
      ])
  })

  it('gives a custom key a humanized label and the plain text editor', () => {
    expect(resolveSuggestedProperties({ suggested_properties: 'due_date' }))
      .toEqual([{ key: 'due_date', label: 'Due date', mode: 'text' }])
  })

  it('drops duplicates that differ only by case or separator', () => {
    expect(resolveSuggestedProperties({ suggested_properties: 'Status, status, STATUS' }))
      .toHaveLength(1)
  })
})

describe('serializeSuggestedProperties', () => {
  it('keeps the empty string, because a cleared list is a deliberate "none"', () => {
    expect(serializeSuggestedProperties('   ')).toBe('')
  })

  it('reports a never-set list as null so the defaults can apply', () => {
    expect(serializeSuggestedProperties(null)).toBeNull()
    expect(serializeSuggestedProperties(undefined)).toBeNull()
  })
})

describe('offersAliasesProperty', () => {
  it('is true only while aliases is listed', () => {
    expect(offersAliasesProperty(resolveSuggestedProperties({ suggested_properties: null }))).toBe(true)
    expect(offersAliasesProperty(resolveSuggestedProperties({ suggested_properties: 'Status' }))).toBe(false)
    expect(offersAliasesProperty(resolveSuggestedProperties({ suggested_properties: 'Aliases' }))).toBe(true)
  })

  it('resolves the Aliases label back to the structural aliases key', () => {
    expect(resolveSuggestedProperties({ suggested_properties: 'Aliases' })[0].key)
      .toBe(ALIASES_PROPERTY_KEY)
  })
})

describe('suggested properties draft', () => {
  it('prefills the defaults when never set, so a blank field means none', () => {
    expect(suggestedPropertiesDraft({ suggested_properties: null }))
      .toBe(DEFAULT_SUGGESTED_PROPERTIES_TEXT)
  })

  it('round-trips a cleared list as a blank field', () => {
    expect(suggestedPropertiesDraft({ suggested_properties: '' })).toBe('')
    expect(suggestedPropertiesFromDraft('')).toEqual([])
    expect(serializeSuggestedPropertiesDraft('')).toBe('')
  })

  it('persists labels so the field reopens showing what the panel offers', () => {
    expect(serializeSuggestedPropertiesDraft('status,  icon ')).toBe('Status, Icon')
  })
})
