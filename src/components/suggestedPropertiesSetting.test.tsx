import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DynamicPropertiesPanel } from './DynamicPropertiesPanel'
import { TooltipProvider } from './ui/tooltip'
import { AppPreferencesProvider } from '../hooks/useAppPreferences'
import { resolveSuggestedProperties, type SuggestedProperty } from '../utils/suggestedProperties'
import type { VaultEntry } from '../types'

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

function renderPanel(
  suggestedProperties: readonly SuggestedProperty[],
  entryOverrides: Partial<VaultEntry> = {},
) {
  return render(
    <TooltipProvider>
      <AppPreferencesProvider suggestedProperties={suggestedProperties}>
        <DynamicPropertiesPanel
          entry={entry(entryOverrides)}
          frontmatter={{}}
          entries={[]}
          onUpdateProperty={vi.fn()}
          onDeleteProperty={vi.fn()}
          onAddProperty={vi.fn()}
        />
      </AppPreferencesProvider>
    </TooltipProvider>,
  )
}

const configured = (text: string) => resolveSuggestedProperties({ suggested_properties: text })

describe('configurable suggested properties', () => {
  it('offers only the configured properties', () => {
    renderPanel(configured('Status, due_date'))

    const slots = screen.getAllByTestId('suggested-property')
    expect(slots.length).toBe(2)
    expect(screen.getByText('Due date')).toBeInTheDocument()
    expect(screen.queryByText('URL')).not.toBeInTheDocument()
  })

  it('shows no slots at all when the list is cleared', () => {
    renderPanel(configured(''))

    expect(screen.queryByTestId('suggested-property')).not.toBeInTheDocument()
    expect(screen.queryByTestId('aliases-property')).not.toBeInTheDocument()
  })

  it('offers an empty Aliases row only while aliases is listed', () => {
    renderPanel(configured('Aliases'))
    expect(screen.getByTestId('aliases-property')).toBeInTheDocument()
    // Aliases has its own row, so it never doubles as a bottom slot.
    expect(screen.queryByTestId('suggested-property')).not.toBeInTheDocument()
  })

  it('always shows aliases a note already has, listed or not', () => {
    renderPanel(configured('Status'), { aliases: ['Castle in the Sky'] })

    expect(screen.getByTestId('aliases-property')).toBeInTheDocument()
    expect(screen.getByText('Castle in the Sky')).toBeInTheDocument()
  })
})
