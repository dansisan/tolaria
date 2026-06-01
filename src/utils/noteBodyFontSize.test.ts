import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTE_FONT_SIZE,
  MAX_NOTE_FONT_SIZE,
  MIN_NOTE_FONT_SIZE,
  NOTE_FONT_SIZE_OPTIONS,
  normalizeNoteFontSize,
  resolveNoteFontSize,
} from './noteBodyFontSize'

describe('noteBodyFontSize', () => {
  it('offers every integer px from min to max', () => {
    expect(NOTE_FONT_SIZE_OPTIONS[0]).toBe(MIN_NOTE_FONT_SIZE)
    expect(NOTE_FONT_SIZE_OPTIONS.at(-1)).toBe(MAX_NOTE_FONT_SIZE)
    expect(NOTE_FONT_SIZE_OPTIONS).toContain(DEFAULT_NOTE_FONT_SIZE)
  })

  it('accepts in-range integers as numbers or numeric strings', () => {
    expect(normalizeNoteFontSize(16)).toBe(16)
    expect(normalizeNoteFontSize('18')).toBe(18)
  })

  it('rejects out-of-range, fractional, and non-numeric values', () => {
    expect(normalizeNoteFontSize(MIN_NOTE_FONT_SIZE - 1)).toBeNull()
    expect(normalizeNoteFontSize(MAX_NOTE_FONT_SIZE + 1)).toBeNull()
    expect(normalizeNoteFontSize(15.5)).toBeNull()
    expect(normalizeNoteFontSize('big')).toBeNull()
    expect(normalizeNoteFontSize(null)).toBeNull()
  })

  it('resolves stored value before fallback before the default', () => {
    expect(resolveNoteFontSize(20, 14)).toBe(20)
    expect(resolveNoteFontSize(null, 14)).toBe(14)
    expect(resolveNoteFontSize(null, 99)).toBe(DEFAULT_NOTE_FONT_SIZE)
  })
})
