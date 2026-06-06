import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteListHeader } from './NoteListHeader'

vi.mock('../../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

const baseProps = {
  title: 'Inbox',
  typeDocument: null,
  isEntityView: false,
  listSort: 'modified' as const,
  listDirection: 'desc' as const,
  customProperties: [],
  searchVisible: true,
  search: 'guitar',
  isSearching: false,
  searchInputRef: { current: null },
  onSortChange: vi.fn(),
  onCreateNote: vi.fn(),
  onOpenType: vi.fn(),
  onToggleSearch: vi.fn(),
  onSearchChange: vi.fn(),
  onSearchKeyDown: vi.fn(),
}

function renderHeader(overrides: Partial<Parameters<typeof NoteListHeader>[0]> = {}) {
  return render(<NoteListHeader {...baseProps} {...overrides} />)
}

describe('NoteListHeader search result count', () => {
  it('shows a pluralized result count while searching', () => {
    renderHeader({ searchResultCount: 12 })
    expect(screen.getByTestId('note-list-search-result-count')).toHaveTextContent('12 results')
  })

  it('uses the singular form for one result', () => {
    renderHeader({ searchResultCount: 1 })
    expect(screen.getByTestId('note-list-search-result-count')).toHaveTextContent('1 result')
  })

  it('shows zero results', () => {
    renderHeader({ searchResultCount: 0 })
    expect(screen.getByTestId('note-list-search-result-count')).toHaveTextContent('0 results')
  })

  it('renders nothing when the count is unavailable', () => {
    renderHeader({ searchResultCount: null })
    expect(screen.queryByTestId('note-list-search-result-count')).not.toBeInTheDocument()
  })

  it('renders nothing when the search box is empty', () => {
    renderHeader({ search: '', searchResultCount: 5 })
    expect(screen.queryByTestId('note-list-search-result-count')).not.toBeInTheDocument()
  })
})
