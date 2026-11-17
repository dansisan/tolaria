import type { FrontmatterUpdates, ResolveNoteDates } from './addNoteDates'
import { noteDateUpdates } from './addNoteDates'

export type UpdateFrontmatter = (
  path: string,
  key: string,
  value: string,
  options?: { silent?: boolean },
) => Promise<void>

export type UpdateFrontmatterKeys = (
  path: string,
  updates: FrontmatterUpdates,
  options?: { silent?: boolean },
) => Promise<void>

/**
 * Give a note the frontmatter it needs: its dates, in one write. Each frontmatter write costs a save flush and a git-status refresh, so
 * separate writes make the dates land visibly later than the type.
 */
export async function initializeNoteProperties(
  deps: {
    updateFrontmatterKeys: UpdateFrontmatterKeys
    resolveNoteDates?: ResolveNoteDates
  },
  path: string,
): Promise<void> {
  const dates = deps.resolveNoteDates ? await noteDateUpdates(deps.resolveNoteDates, path) : []

  // "Note" is the implicit default type, so it is never written to frontmatter.
  if (dates.length === 0) return
  await deps.updateFrontmatterKeys(path, dates, { silent: true })
}
