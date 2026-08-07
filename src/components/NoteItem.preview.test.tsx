import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NoteItem } from './NoteItem'
import { AppPreferencesProvider } from '../hooks/useAppPreferences'
import { makeEntry } from '../test-utils/noteListTestUtils'
import type { NoteListPreview, NoteListPreviewLines } from '../utils/noteListPreview'

const entry = makeEntry({
  path: '/vault/note.md',
  filename: 'note.md',
  title: 'Note',
  snippet: 'Body snippet text.',
  properties: { Description: 'Frontmatter description.' },
})

function renderRow(noteListPreview?: NoteListPreview, rowEntry = entry) {
  render(
    <AppPreferencesProvider noteListPreview={noteListPreview}>
      <NoteItem entry={rowEntry} isSelected={false} typeEntryMap={{}} onClickNote={vi.fn()} />
    </AppPreferencesProvider>,
  )
}

function preview(descriptionProperty: string | null, fallbackLines: NoteListPreviewLines): NoteListPreview {
  return { descriptionProperty, fallbackLines }
}

describe('NoteItem preview', () => {
  it('shows a curated description in full, with no clamp', () => {
    renderRow(preview('description', 1))

    const snippet = screen.getByTestId('note-snippet')
    expect(snippet).toHaveTextContent('Frontmatter description.')
    expect(snippet.style.webkitLineClamp).toBe('')
    expect(snippet.style.overflow).toBe('')
  })

  it('clamps the body fallback to one line by default', () => {
    const plainEntry = makeEntry({
      path: '/vault/plain.md',
      filename: 'plain.md',
      title: 'Plain',
      snippet: 'Body snippet text.',
    })

    renderRow(undefined, plainEntry)

    const snippet = screen.getByTestId('note-snippet')
    expect(snippet).toHaveTextContent('Body snippet text.')
    expect(snippet).toHaveStyle({ WebkitLineClamp: '1' })
  })

  it('prefers the curated description over the body under the default config', () => {
    renderRow()

    expect(screen.getByTestId('note-snippet')).toHaveTextContent('Frontmatter description.')
  })

  it('clamps the body fallback to the configured line count', () => {
    renderRow(preview('summary', 3))

    const snippet = screen.getByTestId('note-snippet')
    expect(snippet).toHaveTextContent('Body snippet text.')
    expect(snippet).toHaveStyle({ WebkitLineClamp: '3' })
  })

  it('drops the preview row when the fallback is off and the note has no description', () => {
    renderRow(preview('summary', 0))

    expect(screen.queryByTestId('note-snippet')).toBeNull()
  })

  it('drops the preview row when the note declares the field blank', () => {
    const blankEntry = makeEntry({
      path: '/vault/blank.md',
      filename: 'blank.md',
      title: 'Blank',
      snippet: 'Body snippet text.',
      properties: { Description: '' },
    })

    renderRow(preview('description', 2), blankEntry)

    expect(screen.queryByTestId('note-snippet')).toBeNull()
  })

  it('uses the body fallback for every note when no description field is configured', () => {
    renderRow(preview(null, 2))

    expect(screen.getByTestId('note-snippet')).toHaveTextContent('Body snippet text.')
  })
})
