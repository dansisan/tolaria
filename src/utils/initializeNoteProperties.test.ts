import { describe, expect, it, vi } from 'vitest'

import { initializeNoteProperties } from './initializeNoteProperties'

const PATH = '/vault/plain-note.md'

describe('initializeNoteProperties', () => {
  it('seeds the type and the dates in a single write', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)
    const resolveNoteDates = vi.fn().mockResolvedValue([
      { key: 'created', value: '2026-06-14 12:17:00' },
      { key: 'dayCreated', value: 'Sun' },
    ])

    await initializeNoteProperties({ updateFrontmatterKeys, resolveNoteDates }, PATH)

    expect(updateFrontmatterKeys).toHaveBeenCalledTimes(1)
    expect(updateFrontmatterKeys).toHaveBeenCalledWith(
      PATH,
      [['type', 'Note'], ['created', '2026-06-14 12:17:00'], ['dayCreated', 'Sun']],
      { silent: true },
    )
  })

  it('writes the type first so the dates land in an existing block', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)

    await initializeNoteProperties({
      updateFrontmatterKeys,
      resolveNoteDates: vi.fn().mockResolvedValue([{ key: 'created', value: 'a' }]),
    }, PATH)

    const [, updates] = updateFrontmatterKeys.mock.calls[0]
    expect(updates[0]).toEqual(['type', 'Note'])
  })

  it('seeds only the type when no date resolver is supplied', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)

    await initializeNoteProperties({ updateFrontmatterKeys }, PATH)

    expect(updateFrontmatterKeys).toHaveBeenCalledWith(PATH, [['type', 'Note']], { silent: true })
  })

  it('seeds the type even when the note already has all its dates', async () => {
    const updateFrontmatterKeys = vi.fn().mockResolvedValue(undefined)

    await initializeNoteProperties({
      updateFrontmatterKeys,
      resolveNoteDates: vi.fn().mockResolvedValue([]),
    }, PATH)

    expect(updateFrontmatterKeys).toHaveBeenCalledWith(PATH, [['type', 'Note']], { silent: true })
  })
})
