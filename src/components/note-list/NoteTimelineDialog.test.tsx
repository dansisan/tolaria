import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { NoteTimelineDialog } from './NoteTimelineDialog'

vi.mock('../../hooks/useAppPreferences', () => ({
  useDateDisplayFormat: () => 'iso' as const,
}))

function entry(year: number, month1: number, day: number): VaultEntry {
  const createdAt = Math.floor(new Date(year, month1 - 1, day, 12).getTime() / 1000)
  return { createdAt } as unknown as VaultEntry
}

// Jan 5/5/7 fall in the same Sunday-week, so the default (week) view is a single bucket.
const SAME_WEEK = [entry(2026, 1, 5), entry(2026, 1, 5), entry(2026, 1, 7)]
const ACROSS_MONTHS = [entry(2026, 1, 5), entry(2026, 4, 5)]

describe('NoteTimelineDialog', () => {
  it('does not render when closed', () => {
    render(<NoteTimelineDialog open={false} onClose={() => {}} entries={SAME_WEEK} />)
    expect(screen.queryByText('Notes over time')).not.toBeInTheDocument()
  })

  it('renders bars and a summary for the charted notes', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={SAME_WEEK} />)
    expect(screen.getByRole('heading', { name: 'Notes over time' })).toBeInTheDocument()
    expect(screen.getAllByTestId('timeline-bar').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('timeline-summary').textContent).toContain('3 notes')
  })

  it('offers Week and Month granularities but not Day', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={SAME_WEEK} />)
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Month' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Day' })).not.toBeInTheDocument()
  })

  it('labels bars with a detailed date + count for the hover tooltip', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={SAME_WEEK} />)
    expect(screen.getAllByTestId('timeline-bar')[0]).toHaveAttribute('aria-label', 'Week of 2026-01-04: 3 notes')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    expect(screen.getAllByTestId('timeline-bar')[0]).toHaveAttribute('aria-label', 'Jan 2026: 3 notes')
  })

  it('renders intermediate x-axis ticks including the first and last bucket', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={[entry(2025, 1, 5), entry(2026, 6, 5)]} />)
    const axis = screen.getByTestId('timeline-axis')
    const ticks = axis.querySelectorAll('span')
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.length).toBeLessThanOrEqual(7)
    expect(axis.textContent).toContain('Jan 2025')
    expect(axis.textContent).toContain('Jun 2026')
  })

  it('re-buckets when the granularity toggle changes', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={ACROSS_MONTHS} />)
    expect(screen.getAllByTestId('timeline-bar').length).toBeGreaterThan(4)
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    // Jan, Feb, Mar, Apr.
    expect(screen.getAllByTestId('timeline-bar')).toHaveLength(4)
  })

  it('shows an empty state when no notes have a created date', () => {
    const undated = [{ createdAt: null }] as unknown as VaultEntry[]
    render(<NoteTimelineDialog open onClose={() => {}} entries={undated} />)
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('timeline-bar')).toHaveLength(0)
  })

  it('uses the provided title for the charted set', () => {
    render(<NoteTimelineDialog open onClose={() => {}} entries={SAME_WEEK} title="Inbox" />)
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
  })

  it('calls onSelectBucket with the clicked bucket when it has notes', () => {
    const onSelectBucket = vi.fn()
    render(<NoteTimelineDialog open onClose={() => {}} entries={SAME_WEEK} onSelectBucket={onSelectBucket} />)

    const bar = screen.getAllByTestId('timeline-bar')[0]
    expect(bar.tagName).toBe('BUTTON')
    fireEvent.click(bar)

    expect(onSelectBucket).toHaveBeenCalledTimes(1)
    expect(onSelectBucket).toHaveBeenCalledWith(expect.objectContaining({ count: 3 }))
  })

  it('does not make empty buckets clickable', () => {
    const onSelectBucket = vi.fn()
    // A one-year span with only two dated notes creates many empty month buckets in between.
    render(
      <NoteTimelineDialog
        open
        onClose={() => {}}
        entries={ACROSS_MONTHS}
        onSelectBucket={onSelectBucket}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))

    const emptyBar = screen.getAllByTestId('timeline-bar').find((bar) => bar.dataset.count === '0')
    expect(emptyBar).toBeDefined()
    expect(emptyBar?.tagName).not.toBe('BUTTON')

    if (emptyBar) fireEvent.click(emptyBar)
    expect(onSelectBucket).not.toHaveBeenCalled()
  })
})
