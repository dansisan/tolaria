import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { resolveRecentEntries } from '../../utils/recentNotes'
import { RecentSection } from './RecentSection'

function entry(path: string, overrides: Partial<VaultEntry> = {}): VaultEntry {
  return { path, title: path.replace('.md', ''), filename: path, isA: null, archived: false, ...overrides } as VaultEntry
}

const entries = [entry('a.md'), entry('b.md'), entry('c.md', { archived: true }), entry('d.md')]

describe('resolveRecentEntries', () => {
  it('keeps visit order, skips missing and archived notes, and honors the count', () => {
    expect(resolveRecentEntries(entries, ['d.md', 'gone.md', 'c.md', 'a.md', 'b.md'], 2).map((e) => e.path)).toEqual(['d.md', 'a.md'])
  })

  it('returns nothing when the count is 0', () => {
    expect(resolveRecentEntries(entries, ['a.md'], 0)).toEqual([])
  })
})

describe('RecentSection', () => {
  const baseProps = { entries, recentPaths: ['b.md', 'a.md'], count: 5, onSelectNote: vi.fn(), collapsed: false, onToggle: vi.fn() }

  it('lists recent notes and opens one on click', () => {
    render(<RecentSection {...baseProps} activePath="b.md" />)
    const items = screen.getAllByTestId('sidebar-recent-item')
    expect(items.map((item) => item.textContent)).toEqual(['b', 'a'])

    fireEvent.click(items[1])
    expect(baseProps.onSelectNote).toHaveBeenCalledWith(entries[0])
  })

  it('renders nothing when there are no recent notes or the section is off', () => {
    const { container, rerender } = render(<RecentSection {...baseProps} recentPaths={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<RecentSection {...baseProps} count={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('hides the list when collapsed', () => {
    render(<RecentSection {...baseProps} collapsed />)
    expect(screen.queryAllByTestId('sidebar-recent-item')).toHaveLength(0)
  })
})
