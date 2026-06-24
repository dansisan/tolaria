import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import { orphanedImageAttachments, orphanedImageAttachmentsForDeletedNotes } from './attachmentPruning'

function note(path: string, attachmentLinks: string[]): VaultEntry {
  return { path, title: path, attachmentLinks } as VaultEntry
}

describe('orphanedImageAttachments', () => {
  it('returns a removed image no other note references', () => {
    const entries = [note('a.md', []), note('b.md', ['attachments/keep.png'])]
    expect(
      orphanedImageAttachments({
        removedLinks: ['attachments/gone.webp'],
        notePath: 'a.md',
        entries,
      }),
    ).toEqual(['attachments/gone.webp'])
  })

  it('keeps an image still referenced by another note', () => {
    const entries = [note('a.md', []), note('b.md', ['attachments/shared.png'])]
    expect(
      orphanedImageAttachments({
        removedLinks: ['attachments/shared.png'],
        notePath: 'a.md',
        entries,
      }),
    ).toEqual([])
  })

  it('ignores the current note when checking references', () => {
    // The current note's stale index entry must not keep its own removed image alive.
    const entries = [note('a.md', ['attachments/gone.webp'])]
    expect(
      orphanedImageAttachments({
        removedLinks: ['attachments/gone.webp'],
        notePath: 'a.md',
        entries,
      }),
    ).toEqual(['attachments/gone.webp'])
  })

  it('only deletes images, not other attachment kinds', () => {
    expect(
      orphanedImageAttachments({
        removedLinks: ['attachments/doc.pdf', 'docs/spec.pdf', 'other.md'],
        notePath: 'a.md',
        entries: [],
      }),
    ).toEqual([])
  })

  it('requires the attachments/ prefix', () => {
    expect(
      orphanedImageAttachments({
        removedLinks: ['images/photo.png'],
        notePath: 'a.md',
        entries: [],
      }),
    ).toEqual([])
  })

  it('deduplicates repeated removed links', () => {
    expect(
      orphanedImageAttachments({
        removedLinks: ['attachments/x.png', 'attachments/x.png'],
        notePath: 'a.md',
        entries: [],
      }),
    ).toEqual(['attachments/x.png'])
  })
})

describe('orphanedImageAttachmentsForDeletedNotes', () => {
  it('returns images referenced only by the deleted note', () => {
    const entries = [note('a.md', ['attachments/gone.png']), note('b.md', ['attachments/keep.png'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md'], entries }),
    ).toEqual(['attachments/gone.png'])
  })

  it('keeps an image still referenced by a surviving note', () => {
    const entries = [note('a.md', ['attachments/shared.png']), note('b.md', ['attachments/shared.png'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md'], entries }),
    ).toEqual([])
  })

  it('frees an image shared by two notes when both are deleted together', () => {
    const entries = [note('a.md', ['attachments/shared.png']), note('b.md', ['attachments/shared.png'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md', 'b.md'], entries }),
    ).toEqual(['attachments/shared.png'])
  })

  it('only deletes images, not other attachment kinds', () => {
    const entries = [note('a.md', ['attachments/doc.pdf', 'docs/spec.pdf', 'other.md'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md'], entries }),
    ).toEqual([])
  })

  it('deduplicates the same image referenced by multiple deleted notes', () => {
    const entries = [note('a.md', ['attachments/x.png']), note('b.md', ['attachments/x.png'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md', 'b.md'], entries }),
    ).toEqual(['attachments/x.png'])
  })

  it('returns nothing when no entries match the deleted paths', () => {
    const entries = [note('b.md', ['attachments/keep.png'])]
    expect(
      orphanedImageAttachmentsForDeletedNotes({ deletedPaths: ['a.md'], entries }),
    ).toEqual([])
  })
})
