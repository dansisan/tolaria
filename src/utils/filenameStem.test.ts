import { describe, expect, it } from 'vitest'
import { sanitizeFilenameStem } from './filenameStem'

const BELL = String.fromCharCode(7)

describe('sanitizeFilenameStem', () => {
  it('keeps spaces and case for stems that are already portable', () => {
    expect(sanitizeFilenameStem('Weekly Review')).toBe('Weekly Review')
    expect(sanitizeFilenameStem('draft.v2')).toBe('draft.v2')
  })

  it('strips characters that no portable filename can hold', () => {
    expect(sanitizeFilenameStem('What now?')).toBe('What now')
    expect(sanitizeFilenameStem('quarterly:plan')).toBe('quarterly plan')
    expect(sanitizeFilenameStem('a/b\\c<d>e"f|g*h')).toBe('a b c d e f g h')
  })

  it('strips control characters', () => {
    expect(sanitizeFilenameStem('line\nbreak')).toBe('line break')
    expect(sanitizeFilenameStem(`bell${BELL}`)).toBe('bell')
  })

  it('drops trailing dots and spaces that Windows rejects', () => {
    expect(sanitizeFilenameStem('overview. ')).toBe('overview')
    expect(sanitizeFilenameStem('notes...')).toBe('notes')
    expect(sanitizeFilenameStem('.')).toBe('')
    expect(sanitizeFilenameStem('..')).toBe('')
  })

  it('escapes Windows reserved device names', () => {
    expect(sanitizeFilenameStem('con')).toBe('con_')
    expect(sanitizeFilenameStem('Lpt1')).toBe('Lpt1_')
    expect(sanitizeFilenameStem('con.backup')).toBe('con_.backup')
    expect(sanitizeFilenameStem('constant')).toBe('constant')
  })

  it('returns empty when nothing usable survives', () => {
    expect(sanitizeFilenameStem('???')).toBe('')
    expect(sanitizeFilenameStem('   ')).toBe('')
  })
})
