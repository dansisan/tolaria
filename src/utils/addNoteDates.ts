import type { NoteDateSuggestion } from '../types'

export type ResolveNoteDates = (path: string) => Promise<NoteDateSuggestion[]>
export type FrontmatterUpdates = [string, string][]

/**
 * The date frontmatter a note is missing, as frontmatter updates.
 *
 * Returned rather than written so a caller can fold it into one write with its own
 * keys.
 */
export async function noteDateUpdates(
  resolveNoteDates: ResolveNoteDates,
  path: string,
): Promise<FrontmatterUpdates> {
  const missing = await resolveNoteDates(path)
  return missing.map(({ key, value }) => [key, value])
}
