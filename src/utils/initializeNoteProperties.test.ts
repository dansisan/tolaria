import { describe, expect, it, vi } from 'vitest'

import { initializeNoteProperties } from './initializeNoteProperties'

const PATH = '/vault/plain-note.md'

describe('initializeNoteProperties', () => {
  it('seeds the dates in a single write and never writes a Note type', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)
    const resolveNoteDates = vi.fn().mockResolvedValue([
      { key: 'created', value: '2026-06-14 12:17:00' },
      { key: 'dayCreated', value: 'Sun' },
    ])

    await initializeNoteProperties({ updateFrontmatterKeys, resolveNoteDates }, PATH)

    expect(updateFrontmatterKeys).toHaveBeenCalledTimes(1)
    expect(updateFrontmatterKeys).toHaveBeenCalledWith(
      PATH,
      [['created', '2026-06-14 12:17:00'], ['dayCreated', 'Sun']],
      { silent: true },
    )
  })

  it('writes nothing when no date resolver is supplied', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)

    await initializeNoteProperties({ updateFrontmatterKeys }, PATH)

    expect(updateFrontmatterKeys).not.toHaveBeenCalled()
  })

  it('writes nothing when the note already has all its dates', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)

    await initializeNoteProperties({
      updateFrontmatterKeys,
      resolveNoteDates: vi.fn().mockResolvedValue([]),
    }, PATH)

    expect(updateFrontmatterKeys).not.toHaveBeenCalled()
  })
})
