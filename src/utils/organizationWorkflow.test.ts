import { describe, expect, it } from 'vitest'
import {
  ALL_NOTES_SELECTION,
  INBOX_SELECTION,
  getDefaultSelectionForOrganization,
  isExplicitOrganizationEnabled,
  isPrimaryNoteListSelection,
  sanitizeSelectionForOrganization,
} from './organizationWorkflow'
import type { SidebarSelection } from '../types'

describe('organizationWorkflow', () => {
  it('treats the setting as enabled by default', () => {
    expect(isExplicitOrganizationEnabled(undefined)).toBe(true)
    expect(isExplicitOrganizationEnabled(null)).toBe(true)
  })

  it('treats explicit false as disabled', () => {
    expect(isExplicitOrganizationEnabled(false)).toBe(false)
  })

  it('defaults to Inbox when explicit organization is enabled', () => {
    expect(getDefaultSelectionForOrganization(true)).toEqual(INBOX_SELECTION)
  })

  it('defaults to All Notes when explicit organization is disabled', () => {
    expect(getDefaultSelectionForOrganization(false)).toEqual(ALL_NOTES_SELECTION)
  })

  it('replaces Inbox selection with All Notes when the workflow is disabled', () => {
    expect(sanitizeSelectionForOrganization(INBOX_SELECTION, false)).toEqual(ALL_NOTES_SELECTION)
  })

  it('leaves non-Inbox selections unchanged when the workflow is disabled', () => {
    const selection = { kind: 'filter', filter: 'archived' } as const
    expect(sanitizeSelectionForOrganization(selection, false)).toEqual(selection)
  })

  it('recognizes All Notes and Inbox as primary note lists', () => {
    expect(isPrimaryNoteListSelection(ALL_NOTES_SELECTION)).toBe(true)
    expect(isPrimaryNoteListSelection(INBOX_SELECTION)).toBe(true)
  })

  it('treats secondary views as non-primary so Escape returns home', () => {
    const secondary: SidebarSelection[] = [
      { kind: 'filter', filter: 'changes' },
      { kind: 'filter', filter: 'pulse' },
      { kind: 'filter', filter: 'archived' },
      { kind: 'view', filename: 'projects.md' },
      { kind: 'folder', path: 'Work' },
    ]
    for (const selection of secondary) {
      expect(isPrimaryNoteListSelection(selection)).toBe(false)
    }
  })
})
