import { describe, expect, it, vi } from 'vitest'
import { buildAppleNotesCommands } from './appleNotesCommands'

describe('buildAppleNotesCommands', () => {
  it('returns no commands when no import handler is provided', () => {
    expect(buildAppleNotesCommands({ enabled: true })).toEqual([])
  })

  it('builds an enabled Note command on supported platforms', () => {
    const onImportAppleNotes = vi.fn()

    const [command] = buildAppleNotesCommands({ enabled: true, onImportAppleNotes })

    expect(command).toMatchObject({
      id: 'import-apple-notes',
      label: 'Import from Apple Notes',
      group: 'Note',
      enabled: true,
    })
    expect(command.keywords).toContain('apple')

    command.execute()
    expect(onImportAppleNotes).toHaveBeenCalledTimes(1)
  })

  it('disables the command on unsupported platforms', () => {
    const [command] = buildAppleNotesCommands({ enabled: false, onImportAppleNotes: vi.fn() })

    expect(command.enabled).toBe(false)
  })
})
