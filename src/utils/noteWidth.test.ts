import { describe, expect, it } from 'vitest'
import {
  canPersistNoteWidthMode,
  normalizeNoteWidthMode,
  resolveNoteWidthMode,
  toggleNoteWidthMode,
} from './noteWidth'

describe('noteWidth', () => {
  it('normalizes supported width modes', () => {
    expect(normalizeNoteWidthMode(' wide ')).toBe('wide')
    expect(normalizeNoteWidthMode('NORMAL')).toBe('normal')
    expect(normalizeNoteWidthMode('expanded')).toBeNull()
  })

  it('resolves note override before the default', () => {
    expect(resolveNoteWidthMode('normal', 'wide')).toBe('normal')
    expect(resolveNoteWidthMode(null, 'normal')).toBe('normal')
    // Falls back to the global default ('wide') when nothing valid is set.
    expect(resolveNoteWidthMode(null, 'expanded')).toBe('wide')
  })

  it('toggles between normal and wide', () => {
    expect(toggleNoteWidthMode('normal')).toBe('wide')
    expect(toggleNoteWidthMode('wide')).toBe('normal')
  })

  it('only persists width when frontmatter already exists', () => {
    expect(canPersistNoteWidthMode('---\ntype: Note\n---\n# Note')).toBe(true)
    expect(canPersistNoteWidthMode('---\n---\n# Note')).toBe(true)
    expect(canPersistNoteWidthMode('# Note')).toBe(false)
    expect(canPersistNoteWidthMode('---\nnot yaml\n---\n# Note')).toBe(false)
  })
})
