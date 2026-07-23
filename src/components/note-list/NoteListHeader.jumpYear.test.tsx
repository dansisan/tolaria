import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteListHeader } from './NoteListHeader'
import { trackEvent } from '../../lib/telemetry'

vi.mock('../../lib/telemetry', () => ({ trackEvent: vi.fn() }))

const baseProps = {
  title: 'All Notes',
  typeDocument: null,
  isEntityView: false,
  listSort: 'modified' as const,
  listDirection: 'desc' as const,
  customProperties: [],
  searchVisible: false,
  search: '',
  isSearching: false,
  searchInputRef: { current: null },
  onSortChange: vi.fn(),
  onCreateNote: vi.fn(),
  onOpenType: vi.fn(),
  onToggleSearch: vi.fn(),
  onOpenTimeline: vi.fn(),
  onSearchChange: vi.fn(),
  onSearchKeyDown: vi.fn(),
}

function renderHeader(overrides: Partial<Parameters<typeof NoteListHeader>[0]> = {}) {
  return render(<NoteListHeader {...baseProps} {...overrides} />)
}

describe('NoteListHeader year-jump buttons', () => {
  it('invokes onJumpByYear with the physical (up/down) direction when clicked', () => {
    const onJumpByYear = vi.fn()
    renderHeader({ canJumpByYear: true, onJumpByYear })

    fireEvent.click(screen.getByTestId('note-list-jump-year-up'))
    expect(onJumpByYear).toHaveBeenCalledWith('up')

    fireEvent.click(screen.getByTestId('note-list-jump-year-down'))
    expect(onJumpByYear).toHaveBeenCalledWith('down')

    expect(trackEvent).toHaveBeenCalledWith('note_list_year_jump', { direction: 'up', via: 'button' })
    expect(trackEvent).toHaveBeenCalledWith('note_list_year_jump', { direction: 'down', via: 'button' })
  })

  it('disables both buttons when canJumpByYear is false (e.g. sorted by title)', () => {
    renderHeader({ canJumpByYear: false, onJumpByYear: vi.fn() })

    expect(screen.getByTestId('note-list-jump-year-up')).toBeDisabled()
    expect(screen.getByTestId('note-list-jump-year-down')).toBeDisabled()
  })

  it('disables both buttons when canJumpByYear is omitted', () => {
    renderHeader({ onJumpByYear: vi.fn() })

    expect(screen.getByTestId('note-list-jump-year-up')).toBeDisabled()
    expect(screen.getByTestId('note-list-jump-year-down')).toBeDisabled()
  })

  it('sorted desc (newest first): down is labeled "earlier", up is labeled "later"', () => {
    renderHeader({ canJumpByYear: true, onJumpByYear: vi.fn(), listDirection: 'desc' })

    expect(screen.getByTestId('note-list-jump-year-down')).toHaveAttribute('title', 'Jump one year earlier (Ctrl+Shift+Down)')
    expect(screen.getByTestId('note-list-jump-year-up')).toHaveAttribute('title', 'Jump one year later (Ctrl+Shift+Up)')
  })

  it('sorted asc (oldest first): the labels flip — down is "later", up is "earlier"', () => {
    renderHeader({ canJumpByYear: true, onJumpByYear: vi.fn(), listDirection: 'asc' })

    expect(screen.getByTestId('note-list-jump-year-down')).toHaveAttribute('title', 'Jump one year later (Ctrl+Shift+Down)')
    expect(screen.getByTestId('note-list-jump-year-up')).toHaveAttribute('title', 'Jump one year earlier (Ctrl+Shift+Up)')
  })

  it('shows the Mac-style symbol shortcut on macOS', () => {
    const originalUserAgent = navigator.userAgent
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })

    try {
      renderHeader({ canJumpByYear: true, onJumpByYear: vi.fn(), listDirection: 'desc' })
      expect(screen.getByTestId('note-list-jump-year-down')).toHaveAttribute('title', 'Jump one year earlier (⌘⇧↓)')
      expect(screen.getByTestId('note-list-jump-year-up')).toHaveAttribute('title', 'Jump one year later (⌘⇧↑)')
    } finally {
      Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: originalUserAgent })
    }
  })
})
