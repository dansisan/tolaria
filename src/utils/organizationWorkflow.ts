import type { SidebarSelection } from '../types'

export const INBOX_SELECTION: SidebarSelection = { kind: 'filter', filter: 'inbox' }
export const ALL_NOTES_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

export function isExplicitOrganizationEnabled(explicitOrganization?: boolean | null): boolean {
  return explicitOrganization !== false
}

export function getDefaultSelectionForOrganization(explicitOrganization?: boolean | null): SidebarSelection {
  return isExplicitOrganizationEnabled(explicitOrganization) ? INBOX_SELECTION : ALL_NOTES_SELECTION
}

/**
 * A primary note list is the home surface a note list always resolves to:
 * All Notes, or Inbox when explicit organization is enabled. Secondary views
 * (Changes, Pulse, Archived, saved Views, folders, entities) are not primary,
 * so Escape returns from them to the home list.
 */
export function isPrimaryNoteListSelection(selection: SidebarSelection): boolean {
  return selection.kind === 'filter' && (selection.filter === 'all' || selection.filter === 'inbox')
}

export function sanitizeSelectionForOrganization(
  selection: SidebarSelection,
  explicitOrganization?: boolean | null,
): SidebarSelection {
  if (!isExplicitOrganizationEnabled(explicitOrganization) && selection.kind === 'filter' && selection.filter === 'inbox') {
    return ALL_NOTES_SELECTION
  }
  return selection
}
