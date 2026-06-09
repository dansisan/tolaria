import type { VaultEntry } from '../types'

export type TimelineGranularity = 'day' | 'week' | 'month'

// Day granularity is intentionally omitted from the UI: single-day bars are rarely
// useful and get unreadably thin over long spans. The bucketing still supports 'day'.
export const TIMELINE_GRANULARITIES: readonly TimelineGranularity[] = ['week', 'month']

export interface TimelineBucket {
  /** Local start-of-bucket timestamp in ms. */
  startMs: number
  label: string
  count: number
}

export interface TimelineData {
  granularity: TimelineGranularity
  buckets: TimelineBucket[]
  /** Number of charted entries (those with a created date). */
  total: number
  maxCount: number
  rangeStartMs: number | null
  rangeEndMs: number | null
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const DAY_MS = 86_400_000

/** Entry created time in ms, or null when the entry has no created date. */
function createdAtMs(entry: Pick<VaultEntry, 'createdAt'>): number | null {
  return entry.createdAt == null ? null : entry.createdAt * 1000
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function startOfWeek(date: Date): number {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // Week starts on Sunday (getDay() === 0).
  midnight.setDate(midnight.getDate() - midnight.getDay())
  return midnight.getTime()
}

function startOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/** Local start-of-bucket timestamp for a moment at the given granularity. */
export function bucketStartMs(ms: number, granularity: TimelineGranularity): number {
  const date = new Date(ms)
  if (granularity === 'day') return startOfDay(date)
  if (granularity === 'week') return startOfWeek(date)
  return startOfMonth(date)
}

// Step by calendar date (not by adding milliseconds) so buckets always land on a
// local midnight / week start. Millisecond stepping drifts across DST boundaries,
// which would leave the stepped cursor off-midnight and miss the local-midnight keys.
function nextBucketStartMs(startMs: number, granularity: TimelineGranularity): number {
  const date = new Date(startMs)
  if (granularity === 'month') return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
  const step = granularity === 'week' ? 7 : 1
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + step).getTime()
}

export function formatBucketLabel(startMs: number, granularity: TimelineGranularity): string {
  const date = new Date(startMs)
  const month = SHORT_MONTHS[date.getMonth()]
  if (granularity === 'month') return `${month} ${date.getFullYear()}`
  if (granularity === 'week') return `${month} ${date.getDate()}, ${date.getFullYear()}`
  return `${month} ${date.getDate()}`
}

/** Pick a sensible granularity from the span of dates so the chart stays readable. */
export function chooseGranularity(rangeStartMs: number, rangeEndMs: number): TimelineGranularity {
  const spanDays = (rangeEndMs - rangeStartMs) / DAY_MS
  return spanDays <= 365 ? 'week' : 'month'
}

function emptyTimeline(granularity: TimelineGranularity): TimelineData {
  return { granularity, buckets: [], total: 0, maxCount: 0, rangeStartMs: null, rangeEndMs: null }
}

// Safety bound so a manual day-granularity over a huge span can't generate runaway buckets.
const MAX_BUCKETS = 1200

/** Build contiguous time buckets (including empty ones) counting entries by created date. */
export function buildTimelineBuckets(
  entries: readonly Pick<VaultEntry, 'createdAt'>[],
  granularity: TimelineGranularity,
): TimelineData {
  const times = entries.map(createdAtMs).filter((ms): ms is number => ms !== null)
  if (times.length === 0) return emptyTimeline(granularity)

  const rangeStartMs = Math.min(...times)
  const rangeEndMs = Math.max(...times)

  const counts = new Map<number, number>()
  for (const ms of times) {
    const key = bucketStartMs(ms, granularity)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const buckets: TimelineBucket[] = []
  let cursor = bucketStartMs(rangeStartMs, granularity)
  const lastStart = bucketStartMs(rangeEndMs, granularity)
  let maxCount = 0
  while (cursor <= lastStart && buckets.length < MAX_BUCKETS) {
    const count = counts.get(cursor) ?? 0
    if (count > maxCount) maxCount = count
    buckets.push({ startMs: cursor, label: formatBucketLabel(cursor, granularity), count })
    cursor = nextBucketStartMs(cursor, granularity)
  }

  return { granularity, buckets, total: times.length, maxCount, rangeStartMs, rangeEndMs }
}

/** Evenly spaced bucket indices for x-axis ticks, always including the first and last. */
export function tickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return []
  if (count <= maxTicks) return Array.from({ length: count }, (_, index) => index)
  const step = (count - 1) / (maxTicks - 1)
  const indices = new Set<number>()
  for (let tick = 0; tick < maxTicks; tick += 1) {
    indices.add(Math.round(tick * step))
  }
  return [...indices].sort((a, b) => a - b)
}

/** Build the timeline using the granularity that best fits the data's span. */
export function buildAutoTimeline(entries: readonly Pick<VaultEntry, 'createdAt'>[]): TimelineData {
  const times = entries.map(createdAtMs).filter((ms): ms is number => ms !== null)
  if (times.length === 0) return emptyTimeline('day')
  const granularity = chooseGranularity(Math.min(...times), Math.max(...times))
  return buildTimelineBuckets(entries, granularity)
}
