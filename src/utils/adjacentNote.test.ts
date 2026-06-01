import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import { resolveAdjacentNote } from './adjacentNote'

function entry(path: string): VaultEntry {
  return { path, title: path } as VaultEntry
}

const list = [entry('a.md'), entry('b.md'), entry('c.md')]

describe('resolveAdjacentNote', () => {
  it('returns the next note below the removed one', () => {
    expect(resolveAdjacentNote(list, 'a.md')?.path).toBe('b.md')
    expect(resolveAdjacentNote(list, 'b.md')?.path).toBe('c.md')
  })

  it('falls back to the previous note when the removed one was last', () => {
    expect(resolveAdjacentNote(list, 'c.md')?.path).toBe('b.md')
  })

  it('returns null when the removed note is the only entry', () => {
    expect(resolveAdjacentNote([entry('a.md')], 'a.md')).toBeNull()
  })

  it('returns null when the removed note is not in the list', () => {
    expect(resolveAdjacentNote(list, 'missing.md')).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(resolveAdjacentNote([], 'a.md')).toBeNull()
  })

  it('skips excluded notes below before falling back above', () => {
    const excluded = new Set(['b.md', 'c.md'])
    expect(resolveAdjacentNote(list, 'b.md', excluded)?.path).toBe('a.md')
  })

  it('returns null when every other note is excluded', () => {
    const excluded = new Set(['a.md', 'c.md'])
    expect(resolveAdjacentNote(list, 'b.md', excluded)).toBeNull()
  })
})
