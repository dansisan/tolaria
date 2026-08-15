import { describe, expect, it, vi } from 'vitest'

import { noteDateUpdates } from './addNoteDates'

const PATH = '/vault/agent-output.md'

describe('noteDateUpdates', () => {
  it('turns the backend suggestions into frontmatter updates', async () => {
    const resolveNoteDates = vi.fn().mockResolvedValue([
      { key: 'created', value: '2026-06-14 12:17:00' },
      { key: 'dayCreated', value: 'Sun' },
      { key: 'modified', value: '2026-06-20 12:59:00' },
    ])

    const updates = await noteDateUpdates(resolveNoteDates, PATH)

    expect(updates).toEqual([
      ['created', '2026-06-14 12:17:00'],
      ['dayCreated', 'Sun'],
      ['modified', '2026-06-20 12:59:00'],
    ])
    expect(resolveNoteDates).toHaveBeenCalledWith(PATH)
  })

  it('yields nothing for a note that already carries its dates', async () => {
    const updates = await noteDateUpdates(vi.fn().mockResolvedValue([]), PATH)

    expect(updates).toEqual([])
  })

  it('preserves the order the backend chose', async () => {
    const resolveNoteDates = vi.fn().mockResolvedValue([
      { key: 'dayCreated', value: 'Sun' },
      { key: 'created', value: 'a' },
    ])

    const updates = await noteDateUpdates(resolveNoteDates, PATH)

    expect(updates.map(([key]) => key)).toEqual(['dayCreated', 'created'])
  })
})
