import { describe, it, expect } from 'vitest'
import {
  bucketStartMs,
  buildAutoTimeline,
  buildTimelineBuckets,
  chooseGranularity,
  formatBucketLabel,
  tickIndices,
} from './noteTimeline'

/** Seconds since epoch for a local calendar moment (matches how createdAt is stored/displayed). */
function secs(year: number, month1: number, day: number, hour = 12): number {
  return Math.floor(new Date(year, month1 - 1, day, hour).getTime() / 1000)
}

function entry(createdAt: number | null) {
  return { createdAt }
}

describe('buildTimelineBuckets', () => {
  it('returns an empty timeline when there are no entries', () => {
    const data = buildTimelineBuckets([], 'day')
    expect(data).toMatchObject({ total: 0, maxCount: 0, buckets: [], rangeStartMs: null, rangeEndMs: null })
  })

  it('ignores entries without a created date', () => {
    const data = buildTimelineBuckets([entry(null), entry(secs(2026, 1, 5))], 'day')
    expect(data.total).toBe(1)
    expect(data.buckets).toHaveLength(1)
  })

  it('produces contiguous day buckets including empty days between dated notes', () => {
    const data = buildTimelineBuckets(
      [entry(secs(2026, 1, 5, 9)), entry(secs(2026, 1, 5, 18)), entry(secs(2026, 1, 5, 23)), entry(secs(2026, 1, 7, 10))],
      'day',
    )
    expect(data.total).toBe(4)
    expect(data.maxCount).toBe(3)
    expect(data.buckets.map((b) => b.count)).toEqual([3, 0, 1])
    expect(data.buckets.map((b) => b.label)).toEqual(['Jan 5', 'Jan 6', 'Jan 7'])
    expect(data.buckets[0].startMs).toBe(bucketStartMs(secs(2026, 1, 5, 9) * 1000, 'day'))
  })

  it('groups by month with year-qualified labels', () => {
    const data = buildTimelineBuckets(
      [entry(secs(2025, 11, 2)), entry(secs(2026, 1, 20)), entry(secs(2026, 1, 28))],
      'month',
    )
    expect(data.buckets.map((b) => b.label)).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026'])
    expect(data.buckets.map((b) => b.count)).toEqual([1, 0, 2])
  })

  it('starts weeks on Sunday and labels them with the year', () => {
    // 2026-01-07 is a Wednesday; its week bucket starts Sunday 2026-01-04.
    const start = bucketStartMs(secs(2026, 1, 7) * 1000, 'week')
    expect(new Date(start).getDay()).toBe(0)
    expect(formatBucketLabel(start, 'week')).toBe('Jan 4, 2026')
  })

  it('counts notes correctly across a DST boundary with calendar-based stepping', () => {
    // Spans the spring DST change; every bucket must stay on local midnight so the
    // later note is still counted (millisecond stepping would drift off-midnight).
    const data = buildTimelineBuckets([entry(secs(2026, 1, 1)), entry(secs(2026, 3, 20))], 'day')
    expect(data.buckets.every((bucket) => new Date(bucket.startMs).getHours() === 0)).toBe(true)
    const target = bucketStartMs(secs(2026, 3, 20) * 1000, 'day')
    expect(data.buckets.find((bucket) => bucket.startMs === target)?.count).toBe(1)
    expect(data.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2)
  })
})

describe('chooseGranularity', () => {
  const start = secs(2026, 1, 1) * 1000
  it('uses week for short spans (day granularity is not auto-selected)', () => {
    expect(chooseGranularity(start, secs(2026, 1, 20) * 1000)).toBe('week')
  })
  it('uses week for spans up to a year', () => {
    expect(chooseGranularity(start, secs(2026, 5, 1) * 1000)).toBe('week')
  })
  it('uses month for multi-year spans', () => {
    expect(chooseGranularity(start, secs(2028, 6, 1) * 1000)).toBe('month')
  })
})

describe('tickIndices', () => {
  it('returns every index when there are fewer buckets than ticks', () => {
    expect(tickIndices(4, 7)).toEqual([0, 1, 2, 3])
  })

  it('spreads ticks evenly and always includes the first and last bucket', () => {
    const ticks = tickIndices(100, 6)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBe(99)
    expect(ticks).toEqual([0, 20, 40, 59, 79, 99])
  })

  it('returns nothing for an empty range', () => {
    expect(tickIndices(0, 6)).toEqual([])
  })
})

describe('buildAutoTimeline', () => {
  it('selects the granularity from the data span', () => {
    const recent = buildAutoTimeline([entry(secs(2026, 1, 5)), entry(secs(2026, 1, 7))])
    expect(recent.granularity).toBe('week')

    const wide = buildAutoTimeline([entry(secs(2022, 1, 1)), entry(secs(2026, 1, 1))])
    expect(wide.granularity).toBe('month')
  })

  it('is empty for entries without created dates', () => {
    expect(buildAutoTimeline([entry(null)]).total).toBe(0)
  })
})
