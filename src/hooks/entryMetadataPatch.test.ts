import { describe, it, expect } from 'vitest'
import { buildEntryMetadataPatch } from './entryMetadataPatch'

describe('buildEntryMetadataPatch', () => {
  it('extracts outgoing wikilinks', () => {
    const patch = buildEntryMetadataPatch('/note.md', 'see [[PageA]] and [[PageB]]')

    expect(patch.outgoingLinks).toEqual(['PageA', 'PageB'])
    expect(patch.attachmentLinks).toEqual([])
  })

  it('uses the link target from pipe-separated wikilinks', () => {
    const patch = buildEntryMetadataPatch('/note.md', 'see [[Target|Display Text]]')

    expect(patch.outgoingLinks).toEqual(['Target'])
  })

  it('falls back to the filename stem when there is no H1', () => {
    const patch = buildEntryMetadataPatch('/renamed-note.md', 'Body without a heading')

    expect(patch).toMatchObject({ title: 'renamed-note', hasH1: false })
  })

  it('ignores an H1 heading for the default Note type (filename is the title)', () => {
    const patch = buildEntryMetadataPatch('/old-title.md', '# Renamed Note\n\nBody')

    expect(patch).toMatchObject({ title: 'old-title', hasH1: false })
  })

  it('still derives the display title from H1 for structured Type instances', () => {
    const patch = buildEntryMetadataPatch('/person-record.md', '---\ntype: Person\n---\n# Jane Doe\n\nBio')

    expect(patch).toMatchObject({ title: 'Jane Doe', hasH1: true })
  })

  it('still derives the display title from frontmatter title for Type instances without H1', () => {
    const patch = buildEntryMetadataPatch('/person-record.md', '---\ntype: Person\ntitle: Jane Doe\n---\nBio')

    expect(patch).toMatchObject({ title: 'Jane Doe', hasH1: false })
  })

  it('derives entry state from valid frontmatter', () => {
    const patch = buildEntryMetadataPatch('/note.md', '---\ntype: Project\nstatus: Active\n---\nBody')

    expect(patch).toMatchObject({ isA: 'Project', status: 'Active' })
  })

  it('does not surface a frontmatter title as an entry field (Notes title by filename)', () => {
    const patch = buildEntryMetadataPatch('/note.md', '---\ntitle: From Frontmatter\n---\nBody')

    // The display title is derived separately; `title` must reflect that, and
    // the raw frontmatter title must not leak through as its own assignment.
    expect(patch.title).toBe('note')
  })

  it('syncs custom relationships and properties from frontmatter', () => {
    const patch = buildEntryMetadataPatch('/note.md', '---\nOwner: [[person/alice]]\ncustom: value\n---\nBody')

    expect(patch).toMatchObject({
      properties: { Owner: '[[person/alice]]', custom: 'value' },
      relationships: { Owner: ['[[person/alice]]'] },
    })
  })

  it('clears stale metadata when frontmatter is removed', () => {
    const patch = buildEntryMetadataPatch('/note.md', 'Body without frontmatter')

    expect(patch).toMatchObject({
      belongsTo: [],
      properties: {},
      relationships: {},
      relatedTo: [],
      status: null,
    })
  })

  it('preserves prior entry state while frontmatter is mid-edit (no closing fence)', () => {
    const patch = buildEntryMetadataPatch('/note.md', '---\nstatus: Active\nOwner: [[person/alice]]\nBody')

    // Incomplete frontmatter must not clobber derived fields; only title/links
    // are computed so the last good frontmatter state is left intact upstream.
    expect(patch).not.toHaveProperty('status')
    expect(patch).not.toHaveProperty('properties')
    expect(patch).toHaveProperty('title')
  })
})
