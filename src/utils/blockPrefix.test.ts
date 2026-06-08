import { describe, expect, it } from 'vitest'
import { blockPrefixText, parseBlockPrefix, PREFIXABLE_BLOCK_TYPES } from './blockPrefix'

describe('blockPrefixText', () => {
  it('renders heading levels as hash runs', () => {
    expect(blockPrefixText({ type: 'heading', props: { level: 1 } })).toBe('#')
    expect(blockPrefixText({ type: 'heading', props: { level: 3 } })).toBe('###')
    expect(blockPrefixText({ type: 'heading', props: { level: 6 } })).toBe('######')
  })

  it('renders list and quote markers', () => {
    expect(blockPrefixText({ type: 'bulletListItem', props: {} })).toBe('-')
    expect(blockPrefixText({ type: 'numberedListItem', props: {} })).toBe('1.')
    expect(blockPrefixText({ type: 'quote', props: {} })).toBe('>')
  })

  it('renders checklist markers from the checked prop', () => {
    expect(blockPrefixText({ type: 'checkListItem', props: { checked: false } })).toBe('- [ ]')
    expect(blockPrefixText({ type: 'checkListItem', props: { checked: true } })).toBe('- [x]')
  })

  it('returns null for non-prefixable blocks', () => {
    expect(blockPrefixText({ type: 'paragraph', props: {} })).toBeNull()
    expect(blockPrefixText({ type: 'codeBlock', props: { language: 'js' } })).toBeNull()
    expect(blockPrefixText({ type: 'table', props: {} })).toBeNull()
  })

  it('exposes the prefixable type set', () => {
    expect(PREFIXABLE_BLOCK_TYPES.has('heading')).toBe(true)
    expect(PREFIXABLE_BLOCK_TYPES.has('paragraph')).toBe(false)
  })
})

describe('parseBlockPrefix', () => {
  it('parses hash runs into heading levels', () => {
    expect(parseBlockPrefix('##')).toEqual({ type: 'heading', props: { level: 2 } })
    expect(parseBlockPrefix('######')).toEqual({ type: 'heading', props: { level: 6 } })
  })

  it('rejects hash runs beyond six levels', () => {
    expect(parseBlockPrefix('#######')).toBeNull()
  })

  it('parses list, quote, and checklist markers', () => {
    expect(parseBlockPrefix('-')).toEqual({ type: 'bulletListItem', props: {} })
    expect(parseBlockPrefix('*')).toEqual({ type: 'bulletListItem', props: {} })
    expect(parseBlockPrefix('1.')).toEqual({ type: 'numberedListItem', props: {} })
    expect(parseBlockPrefix('7.')).toEqual({ type: 'numberedListItem', props: {} })
    expect(parseBlockPrefix('>')).toEqual({ type: 'quote', props: {} })
    expect(parseBlockPrefix('- [ ]')).toEqual({ type: 'checkListItem', props: { checked: false } })
    expect(parseBlockPrefix('- [x]')).toEqual({ type: 'checkListItem', props: { checked: true } })
  })

  it('parses an empty prefix as a plain paragraph', () => {
    expect(parseBlockPrefix('')).toEqual({ type: 'paragraph', props: {} })
    expect(parseBlockPrefix('  ')).toEqual({ type: 'paragraph', props: {} })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseBlockPrefix(' ## ')).toEqual({ type: 'heading', props: { level: 2 } })
  })

  it('rejects unknown markers', () => {
    expect(parseBlockPrefix('@@')).toBeNull()
    expect(parseBlockPrefix('## extra')).toBeNull()
  })
})
