import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { VaultEntry } from '../../types'
import { useRevealSelectedNote } from './useNoteListModel'

function entry(path: string): VaultEntry {
  return { path, title: path } as VaultEntry
}

const searched = [entry('a.md'), entry('b.md'), entry('c.md')]

function renderReveal(scrollIntoView = vi.fn()) {
  const virtuosoRef = { current: { scrollIntoView } } as never
  const hook = renderHook(
    ({ sel }: { sel: string | null }) =>
      useRevealSelectedNote({ selectedNotePath: sel, searched, virtuosoRef }),
    { initialProps: { sel: null as string | null } },
  )
  return { scrollIntoView, ...hook }
}

describe('useRevealSelectedNote', () => {
  it('scrolls the newly selected note into view', () => {
    const { scrollIntoView, rerender } = renderReveal()
    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender({ sel: 'c.md' })
    expect(scrollIntoView).toHaveBeenCalledWith({ index: 2, behavior: 'auto' })
  })

  it('does not scroll again while the selection is unchanged', () => {
    const { scrollIntoView, rerender } = renderReveal()
    rerender({ sel: 'b.md' })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender({ sel: 'b.md' })
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does not scroll when the selected note is not in the list', () => {
    const { scrollIntoView, rerender } = renderReveal()
    rerender({ sel: 'missing.md' })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
