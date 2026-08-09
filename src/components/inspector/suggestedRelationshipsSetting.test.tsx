import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DynamicRelationshipsPanel } from '../InspectorPanels'
import { TooltipProvider } from '../ui/tooltip'
import { AppPreferencesProvider } from '../../hooks/useAppPreferences'
import type { VaultEntry } from '../../types'

Element.prototype.scrollIntoView = vi.fn()

const entry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  template: null,
  sort: null,
  outgoingLinks: [],
  ...overrides,
} as VaultEntry)

function renderPanel(suggestedRelationships: readonly string[], children?: ReactNode) {
  return render(
    <TooltipProvider>
      <AppPreferencesProvider suggestedRelationships={suggestedRelationships}>
        <DynamicRelationshipsPanel
          typeEntryMap={{}}
          frontmatter={{}}
          entries={[entry()]}
          onNavigate={vi.fn()}
          onAddProperty={vi.fn()}
        />
        {children}
      </AppPreferencesProvider>
    </TooltipProvider>,
  )
}

describe('configurable suggested relationships', () => {
  it('offers only the configured relationships', () => {
    renderPanel(['Depends on', 'has_part'])

    const slots = screen.getAllByTestId('suggested-relationship')
    expect(slots.length).toBe(2)
    expect(within(slots[0]).getByText('Depends on')).toBeInTheDocument()
    expect(within(slots[1]).getByText('Has part')).toBeInTheDocument()
    expect(screen.queryByText('Belongs to')).not.toBeInTheDocument()
  })

  it('falls back to the Add relationship button alone when the list is cleared', () => {
    renderPanel([])

    expect(screen.queryByTestId('suggested-relationship')).not.toBeInTheDocument()
    expect(screen.getByText('+ Add relationship')).toBeInTheDocument()
  })
})
