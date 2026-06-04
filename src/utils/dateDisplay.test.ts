import { describe, expect, it } from 'vitest'
import {
  formatDateForDisplay,
  formatDatePartsForDisplay,
  formatDateValueForDisplay,
  formatRelativeTime,
  normalizeDateDisplayFormat,
} from './dateDisplay'

describe('dateDisplay', () => {
  it('normalizes supported date display formats', () => {
    expect(normalizeDateDisplayFormat(' ISO ')).toBe('iso')
    expect(normalizeDateDisplayFormat('friendly')).toBe('friendly')
    expect(normalizeDateDisplayFormat('long')).toBeNull()
    expect(normalizeDateDisplayFormat(null)).toBeNull()
  })

  it('formats date parts in every supported display style', () => {
    const parts = { year: 2026, month: 5, day: 11 }

    expect(formatDatePartsForDisplay(parts, 'us')).toBe('5/11/2026')
    expect(formatDatePartsForDisplay(parts, 'european')).toBe('11/5/2026')
    expect(formatDatePartsForDisplay(parts, 'friendly')).toBe('May 11, 2026')
    expect(formatDatePartsForDisplay(parts, 'iso')).toBe('2026-05-11')
  })

  it('uses three-letter month abbreviations in friendly format when shortMonth is set', () => {
    expect(formatDatePartsForDisplay({ year: 2026, month: 1, day: 4 }, 'friendly', true)).toBe('Jan 4, 2026')
    expect(formatDatePartsForDisplay({ year: 2026, month: 9, day: 20 }, 'friendly', true)).toBe('Sep 20, 2026')
    expect(formatDateForDisplay(new Date(2026, 8, 20), 'friendly', true, true)).toBe('Sun, Sep 20, 2026')
    // Non-friendly formats are unaffected by shortMonth.
    expect(formatDatePartsForDisplay({ year: 2026, month: 1, day: 4 }, 'iso', true)).toBe('2026-01-04')
  })

  it('prepends the short weekday when includeWeekday is set', () => {
    const date = new Date(2026, 4, 11) // Monday, May 11, 2026 (local)

    expect(formatDateForDisplay(date, 'friendly')).toBe('May 11, 2026')
    expect(formatDateForDisplay(date, 'friendly', true)).toBe('Mon, May 11, 2026')
    expect(formatDateForDisplay(date, 'iso', true)).toBe('Mon, 2026-05-11')
  })

  it('describes relative time in coarse, singular/plural buckets', () => {
    const now = 1_000_000_000_000 // fixed "now" in ms
    const nowSec = now / 1000
    const ago = (seconds: number) => formatRelativeTime(nowSec - seconds, now)

    expect(ago(30)).toBe('just now')
    expect(ago(60)).toBe('1 min ago')
    expect(ago(15 * 60)).toBe('15 mins ago')
    expect(ago(60 * 60)).toBe('1 hour ago')
    expect(ago(3 * 60 * 60)).toBe('3 hours ago')
    expect(ago(5 * 86400)).toBe('5 days ago')
    expect(ago(2 * 30 * 86400)).toBe('2 months ago')
    expect(ago(2 * 365 * 86400)).toBe('2 years ago')
    expect(formatRelativeTime(null, now)).toBe('')

    // Rounds the count, and rounds up to "2 years" for 18 months.
    expect(ago(90)).toBe('2 mins ago') // 1.5 min → 2
    expect(ago(18 * 30 * 86400)).toBe('2 years ago')
    expect(ago(13 * 30 * 86400)).toBe('1 year ago')
    // Promotes cleanly at unit boundaries instead of "60 mins"/"24 hours".
    expect(ago(59.5 * 60)).toBe('1 hour ago')
    expect(ago(23.6 * 3600)).toBe('1 day ago')
  })

  it('formats ISO and slash date values without changing non-dates', () => {
    expect(formatDateValueForDisplay('2026-05-11', 'european')).toBe('11/5/2026')
    expect(formatDateValueForDisplay('05/11/2026', 'friendly')).toBe('May 11, 2026')
    expect(formatDateValueForDisplay('next Monday', 'iso')).toBe('next Monday')
  })
})
