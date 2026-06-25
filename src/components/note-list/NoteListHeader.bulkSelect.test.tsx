import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteListHeader } from './NoteListHeader'
import { getAppCommandShortcutDisplay } from '../../hooks/appCommandCatalog'
import { APP_COMMAND_IDS } from '../../hooks/appCommandDispatcher'

const SHORTCUT = getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteBulkSelect)!

vi.mock('../../lib/telemetry', () => ({ trackEvent: vi.fn() }))

const baseProps = {
  title: 'Inbox',
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

describe('NoteListHeader bulk-select toggle', () => {
  it('invokes onToggleBulkMode when the Select button is clicked', () => {
    const onToggleBulkMode = vi.fn()
    renderHeader({ onToggleBulkMode })

    const button = screen.getByTestId('note-list-bulk-select-toggle')
    expect(button.getAttribute('aria-label')).toContain('Select notes')
    expect(button.getAttribute('aria-label')).toContain(SHORTCUT)
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(onToggleBulkMode).toHaveBeenCalledTimes(1)
  })

  it('reflects the active state with a Done label when bulk mode is on', () => {
    renderHeader({ onToggleBulkMode: vi.fn(), bulkMode: true })

    const button = screen.getByTestId('note-list-bulk-select-toggle')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.getAttribute('aria-label')).toContain('Done selecting')
  })

  it('hides the Select button in the changes view', () => {
    renderHeader({ onToggleBulkMode: vi.fn(), isChangesView: true })
    expect(screen.queryByTestId('note-list-bulk-select-toggle')).toBeNull()
  })

  it('hides the Select button when no toggle handler is provided', () => {
    renderHeader()
    expect(screen.queryByTestId('note-list-bulk-select-toggle')).toBeNull()
  })
})
