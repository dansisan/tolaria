import { extractOutgoingLinks, extractAttachmentLinks, extractSnippet, countWords } from '../utils/wikilinks'
import { deriveRawEditorEntryState } from './rawEditorEntryState'
import { deriveDisplayTitleState, filenameStemToTitle, isDefaultNoteType } from '../utils/noteTitle'
import { detectFrontmatterState } from '../utils/frontmatter'
import type { VaultEntry } from '../types'

/**
 * True when the raw content has frontmatter we can safely derive entry state
 * from. Invalid YAML, or a frontmatter block that is still being typed (opens
 * with `---` but has no close yet), is left alone so we keep the last good
 * derived state instead of clobbering it with garbage.
 */
function shouldSyncFrontmatterState(content: string): boolean {
  const frontmatterState = detectFrontmatterState(content)
  if (frontmatterState === 'invalid') return false
  return !(frontmatterState === 'none' && content.startsWith('---\n'))
}

function frontmatterEntryState(content: string): Partial<VaultEntry> | null {
  if (!shouldSyncFrontmatterState(content)) return null
  return deriveRawEditorEntryState(content)
}

/** Display title is derived separately, so drop any frontmatter `title`. */
function withoutTitle(patch: Partial<VaultEntry>): Partial<VaultEntry> {
  const rest = { ...patch }
  delete rest.title
  return rest
}

/**
 * Defaults to Note when frontmatter can't be parsed yet (mid-edit), matching
 * the "no type declared" case.
 */
function isDefaultNoteFrontmatter(frontmatter: Partial<VaultEntry> | null): boolean {
  return !frontmatter || isDefaultNoteType(frontmatter.isA)
}

/**
 * Builds the full note-list/inspector metadata patch (outgoing links, attachment
 * links, snippet, word count, derived frontmatter state and display title) for a
 * note from its raw content.
 *
 * Pure and deterministic — `modifiedAt` is stamped by the caller so this stays
 * trivial to test. Computed at save time rather than on every keystroke so
 * typing never blocks on link/frontmatter/title extraction.
 */
export function buildEntryMetadataPatch(path: string, content: string): Partial<VaultEntry> {
  const filename = path.split('/').pop() ?? path
  const frontmatter = frontmatterEntryState(content)
  const frontmatterTitle = typeof frontmatter?.title === 'string' ? frontmatter.title : null
  const displayTitleState = isDefaultNoteFrontmatter(frontmatter)
    ? { title: filenameStemToTitle(filename), hasH1: false }
    : deriveDisplayTitleState({ content, filename, frontmatterTitle })
  return {
    ...(frontmatter ? withoutTitle(frontmatter) : {}),
    ...displayTitleState,
    outgoingLinks: extractOutgoingLinks(content),
    attachmentLinks: extractAttachmentLinks(content),
    snippet: extractSnippet(content),
    wordCount: countWords(content),
  }
}
