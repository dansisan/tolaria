import type { VaultEntry } from '../types'

const RELATIVE_ATTACHMENTS_PREFIX = 'attachments/'
const IMAGE_ATTACHMENT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff']

interface OrphanQuery {
  removedLinks: string[]
  notePath: string
  entries: VaultEntry[]
}

function isImageAttachmentPath(link: string): boolean {
  if (!link.startsWith(RELATIVE_ATTACHMENTS_PREFIX)) return false
  const ext = link.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_ATTACHMENT_EXTENSIONS.includes(ext)
}

function isReferencedByOtherNote(link: string, notePath: string, entries: VaultEntry[]): boolean {
  return entries.some(
    (entry) => entry.path !== notePath && (entry.attachmentLinks?.includes(link) ?? false),
  )
}

/**
 * Of the image attachment references just removed from `notePath`, return those
 * that no other note still references — the files safe to delete from disk.
 * Non-image links (other notes, pdfs) and still-shared images are filtered out.
 */
export function orphanedImageAttachments({ removedLinks, notePath, entries }: OrphanQuery): string[] {
  const seen = new Set<string>()
  const orphans: string[] = []
  for (const link of removedLinks) {
    if (seen.has(link) || !isImageAttachmentPath(link)) continue
    seen.add(link)
    if (!isReferencedByOtherNote(link, notePath, entries)) orphans.push(link)
  }
  return orphans
}
