import { describe, expect, it } from 'vitest'
import { linksWithPlainItems, plainItems, propertiesPanelValue, withPreservedWikilinks, wikilinkItems } from './mixedWikilinkLists'

describe('propertiesPanelValue', () => {
  it('passes scalars and plain lists through', () => {
    expect(propertiesPanelValue('Wed')).toBe('Wed')
    expect(propertiesPanelValue(['a', 'b'])).toEqual(['a', 'b'])
    expect(propertiesPanelValue(-0.45)).toBe(-0.45)
    expect(propertiesPanelValue(null)).toBeNull()
  })

  it('hides values that are only wikilinks', () => {
    expect(propertiesPanelValue('[[H]]')).toBeUndefined()
    expect(propertiesPanelValue(['[[H]]', '[[V]]'])).toBeUndefined()
  })

  it('keeps only the plain items of a mixed list', () => {
    expect(propertiesPanelValue(['[[H]]', 'Martha', 'Kate'])).toEqual(['Martha', 'Kate'])
    expect(propertiesPanelValue(['[[H]]', 'Martha'])).toBe('Martha')
  })
})

describe('withPreservedWikilinks', () => {
  it('returns the edit unchanged when the field had no wikilinks', () => {
    expect(withPreservedWikilinks(['a'], ['b', 'c'])).toEqual(['b', 'c'])
    expect(withPreservedWikilinks(undefined, 'b')).toBe('b')
  })

  it('puts existing wikilinks back in front of the edited plain items', () => {
    expect(withPreservedWikilinks(['[[H]]', '[[V]]', 'Martha'], ['Kate', 'Adam'])).toEqual(['[[H]]', '[[V]]', 'Kate', 'Adam'])
    expect(withPreservedWikilinks(['[[H]]', 'Martha'], 'Kate')).toEqual(['[[H]]', 'Kate'])
  })

  it('collapses to a scalar when a single item remains', () => {
    expect(withPreservedWikilinks(['[[H]]', 'Martha'], [])).toBe('[[H]]')
  })
})

describe('wikilinkItems', () => {
  it('lists only wikilink items of a list', () => {
    expect(wikilinkItems(['[[H]]', 'Martha'])).toEqual(['[[H]]'])
    expect(wikilinkItems('[[H]]')).toEqual([])
  })
})

describe('plainItems and linksWithPlainItems', () => {
  it('collects plain names from lists and lone strings', () => {
    expect(plainItems(['[[H]]', 'Martha', 'Kate'])).toEqual(['Martha', 'Kate'])
    expect(plainItems('Martha')).toEqual(['Martha'])
    expect(plainItems('[[H]]')).toEqual([])
    expect(plainItems(undefined)).toEqual([])
  })

  it('puts links first and keeps the plain names', () => {
    expect(linksWithPlainItems(['[[H]]', 'Martha'], ['[[H]]', '[[V]]'])).toEqual(['[[H]]', '[[V]]', 'Martha'])
  })

  it('collapses to a scalar and reports empty as null', () => {
    expect(linksWithPlainItems(['[[H]]', 'Martha'], [])).toBe('Martha')
    expect(linksWithPlainItems(['[[H]]'], [])).toBeNull()
  })
})
