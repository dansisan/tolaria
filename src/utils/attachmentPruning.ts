import type { VaultEntry } from '../types'

const RELATIVE_ATTACHMENTS_PREFIX = 'attachments/'
const IMAGE_ATTACHMENT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff']

interface OrphanQuery {
  removedLinks: string[]
  notePath: string
  entries: VaultEntry[]
}

interface DeletionOrphanQuery {
  deletedPaths: string[]
  entries: VaultEntry[]
}

function isImageAttachmentPath(link: string): boolean {
  if (!link.startsWith(RELATIVE_ATTACHMENTS_PREFIX)) return false
  const ext = link.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_ATTACHMENT_EXTENSIONS.includes(ext)
}

function isReferencedOutside(link: string, excludedPaths: Set<string>, entries: VaultEntry[]): boolean {
  return entries.some(
    (entry) => !excludedPaths.has(entry.path) && (entry.attachmentLinks?.includes(link) ?? false),
  )
}

function collectOrphans(links: Iterable<string>, excludedPaths: Set<string>, entries: VaultEntry[]): string[] {
  const seen = new Set<string>()
  const orphans: string[] = []
  for (const link of links) {
    if (seen.has(link) || !isImageAttachmentPath(link)) continue
    seen.add(link)
    if (!isReferencedOutside(link, excludedPaths, entries)) orphans.push(link)
  }
  return orphans
}

/**
 * Of the image attachment references just removed from `notePath`, return those
 * that no other note still references — the files safe to delete from disk.
 * Non-image links (other notes, pdfs) and still-shared images are filtered out.
 */
export function orphanedImageAttachments({ removedLinks, notePath, entries }: OrphanQuery): string[] {
  return collectOrphans(removedLinks, new Set([notePath]), entries)
}

/**
 * Image attachments referenced only by the notes being deleted — safe to remove
 * from disk once those notes are gone. `entries` must be the pre-deletion snapshot
 * so the deleted notes' attachment links are still available; images still
 * referenced by any surviving note are kept.
 */
export function orphanedImageAttachmentsForDeletedNotes({ deletedPaths, entries }: DeletionOrphanQuery): string[] {
  const deleted = new Set(deletedPaths)
  const removedLinks = entries
    .filter((entry) => deleted.has(entry.path))
    .flatMap((entry) => entry.attachmentLinks ?? [])
  return collectOrphans(removedLinks, deleted, entries)
}
