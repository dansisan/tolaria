import { describe, it, expect } from 'vitest'
import {
  CODE_FONT_SIZE_OPTIONS,
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  normalizeCodeFontSize,
} from './codeFontSize'

describe('codeFontSize', () => {
  it('offers every integer px from min to max', () => {
    expect(CODE_FONT_SIZE_OPTIONS[0]).toBe(MIN_CODE_FONT_SIZE)
    expect(CODE_FONT_SIZE_OPTIONS.at(-1)).toBe(MAX_CODE_FONT_SIZE)
    expect(CODE_FONT_SIZE_OPTIONS).toHaveLength(MAX_CODE_FONT_SIZE - MIN_CODE_FONT_SIZE + 1)
  })

  it('accepts in-range integers as numbers or numeric strings', () => {
    expect(normalizeCodeFontSize(13)).toBe(13)
    expect(normalizeCodeFontSize('16')).toBe(16)
  })

  it('rejects out-of-range, fractional, and non-numeric values', () => {
    expect(normalizeCodeFontSize(MIN_CODE_FONT_SIZE - 1)).toBeNull()
    expect(normalizeCodeFontSize(MAX_CODE_FONT_SIZE + 1)).toBeNull()
    expect(normalizeCodeFontSize(13.5)).toBeNull()
    expect(normalizeCodeFontSize('big')).toBeNull()
    expect(normalizeCodeFontSize(null)).toBeNull()
    expect(normalizeCodeFontSize(undefined)).toBeNull()
  })
})
