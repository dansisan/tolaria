import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { VaultEntry } from '../../types'
import { translate, type AppLocale } from '../../lib/i18n'
import { formatTimestampForDateDisplay, type DateDisplayFormat } from '../../utils/dateDisplay'
import { useDateDisplayFormat } from '../../hooks/useAppPreferences'
import {
  buildAutoTimeline,
  buildTimelineBuckets,
  tickIndices,
  TIMELINE_GRANULARITIES,
  type TimelineBucket,
  type TimelineData,
  type TimelineGranularity,
} from '../../utils/noteTimeline'

const AXIS_TICK_COUNT = 7

interface NoteTimelineDialogProps {
  open: boolean
  onClose: () => void
  entries: VaultEntry[]
  /** Heading describing the charted set (e.g. the active filter or search). */
  title?: string
  locale?: AppLocale
}

const GRANULARITY_LABEL_KEYS = {
  day: 'noteList.timeline.granularity.day',
  week: 'noteList.timeline.granularity.week',
  month: 'noteList.timeline.granularity.month',
} as const satisfies Record<TimelineGranularity, string>

/** A full, granularity-aware date label for a bucket (e.g. a precise day, "Week of …", or month). */
function bucketDateLabel(
  locale: AppLocale,
  granularity: TimelineGranularity,
  bucket: TimelineBucket,
  dateDisplayFormat: DateDisplayFormat,
): string {
  if (granularity === 'month') return bucket.label
  const date = formatTimestampForDateDisplay(Math.floor(bucket.startMs / 1000), dateDisplayFormat)
  if (granularity === 'week') return translate(locale, 'noteList.timeline.weekOf', { date })
  return date
}

function bucketDetail(
  locale: AppLocale,
  granularity: TimelineGranularity,
  bucket: TimelineBucket,
  dateDisplayFormat: DateDisplayFormat,
): string {
  return translate(locale, 'noteList.timeline.bucketLabel', {
    label: bucketDateLabel(locale, granularity, bucket, dateDisplayFormat),
    count: bucket.count,
    plural: bucket.count === 1 ? '' : 's',
  })
}

function GranularityToggle({
  value,
  onChange,
  locale,
}: {
  value: TimelineGranularity
  onChange: (granularity: TimelineGranularity) => void
  locale: AppLocale
}) {
  return (
    <div className="flex gap-1">
      {TIMELINE_GRANULARITIES.map((granularity) => (
        <Button
          key={granularity}
          type="button"
          size="xs"
          variant={value === granularity ? 'default' : 'outline'}
          onClick={() => onChange(granularity)}
        >
          {translate(locale, GRANULARITY_LABEL_KEYS[granularity])}
        </Button>
      ))}
    </div>
  )
}

function TimelineBars({
  data,
  locale,
  dateDisplayFormat,
}: {
  data: TimelineData
  locale: AppLocale
  dateDisplayFormat: DateDisplayFormat
}) {
  return (
    <TooltipProvider delayDuration={80}>
      <div className="flex h-72 items-end gap-px border-b border-border" data-testid="timeline-bars">
        {data.buckets.map((bucket) => {
          const pct = data.maxCount > 0 ? (bucket.count / data.maxCount) * 100 : 0
          const detail = bucketDetail(locale, data.granularity, bucket, dateDisplayFormat)
          return (
            <Tooltip key={bucket.startMs}>
              <TooltipTrigger asChild>
                <div
                  className="flex h-full flex-1 flex-col justify-end"
                  aria-label={detail}
                  data-testid="timeline-bar"
                  data-count={bucket.count}
                >
                  <div
                    className={cn('w-full rounded-t-sm', bucket.count > 0 ? 'bg-primary hover:bg-primary/80' : 'bg-muted')}
                    style={{ height: bucket.count > 0 ? `max(3px, ${pct}%)` : '2px' }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>{detail}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function TimelineAxis({ buckets }: { buckets: TimelineBucket[] }) {
  const total = buckets.length
  return (
    <div className="relative h-4 text-[11px] text-muted-foreground" data-testid="timeline-axis">
      {tickIndices(total, AXIS_TICK_COUNT).map((index) => (
        <span
          key={buckets[index].startMs}
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${((index + 0.5) / total) * 100}%` }}
        >
          {buckets[index].label}
        </span>
      ))}
    </div>
  )
}

function TimelineChart({ entries, locale }: { entries: VaultEntry[]; locale: AppLocale }) {
  const dateDisplayFormat = useDateDisplayFormat()
  const auto = useMemo(() => buildAutoTimeline(entries), [entries])
  const [granularity, setGranularity] = useState<TimelineGranularity>(auto.granularity)
  const data = useMemo(() => buildTimelineBuckets(entries, granularity), [entries, granularity])

  if (data.total === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground" data-testid="timeline-empty">
        {translate(locale, 'noteList.timeline.empty')}
      </p>
    )
  }

  const start = formatTimestampForDateDisplay(Math.floor((data.rangeStartMs ?? 0) / 1000), dateDisplayFormat)
  const end = formatTimestampForDateDisplay(Math.floor((data.rangeEndMs ?? 0) / 1000), dateDisplayFormat)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground" data-testid="timeline-summary">
          {translate(locale, 'noteList.timeline.summary', {
            count: data.total,
            plural: data.total === 1 ? '' : 's',
            start,
            end,
          })}
        </p>
        <GranularityToggle value={granularity} onChange={setGranularity} locale={locale} />
      </div>
      <TimelineBars data={data} locale={locale} dateDisplayFormat={dateDisplayFormat} />
      <TimelineAxis buckets={data.buckets} />
    </div>
  )
}

export function NoteTimelineDialog({ open, onClose, entries, title, locale = 'en' }: NoteTimelineDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[960px]">
        <DialogHeader>
          <DialogTitle>{title ?? translate(locale, 'noteList.timeline.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate(locale, 'noteList.timeline.title')}
          </DialogDescription>
        </DialogHeader>
        <TimelineChart entries={entries} locale={locale} />
      </DialogContent>
    </Dialog>
  )
}
