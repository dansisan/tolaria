import { describe, expect, it } from 'vitest'
import {
  deriveDisplayTitleState,
  extractFrontmatterTitleFromContent,
  extractH1TitleFromContent,
  filenameStemToTitle,
  syncFilenameDerivedFrontmatterTitle,
} from './noteTitle'

describe('filenameStemToTitle', () => {
  it('strips the extension and returns the stem as-is', () => {
    expect(filenameStemToTitle('renamed-note.md')).toBe('renamed-note')
  })

  it('preserves dashes in the stem', () => {
    expect(filenameStemToTitle('my-project-plan.md')).toBe('my-project-plan')
  })

  it('works for single-word filenames', () => {
    expect(filenameStemToTitle('note.md')).toBe('note')
  })
})

describe('extractH1TitleFromContent', () => {
  it('extracts the first H1 after frontmatter', () => {
    const content = '---\ntitle: Legacy Title\n---\n# Updated Title\n\nBody'
    expect(extractH1TitleFromContent(content)).toBe('Updated Title')
  })

  it('strips markdown formatting from the H1', () => {
    const content = '# **Bold** [Link](https://example.com) and `code`'
    expect(extractH1TitleFromContent(content)).toBe('Bold Link and code')
  })

  it('preserves plain square brackets in the H1', () => {
    const content = '# [26Q2] Tolaria MVP'
    expect(extractH1TitleFromContent(content)).toBe('[26Q2] Tolaria MVP')
  })

  it('returns null when the first non-empty line is not an H1', () => {
    expect(extractH1TitleFromContent('Body first\n# Not the title')).toBeNull()
  })
})

describe('extractFrontmatterTitleFromContent', () => {
  it('extracts the frontmatter title when present', () => {
    const content = '---\ntitle: Legacy Title\nstatus: Active\n---\n## Body'
    expect(extractFrontmatterTitleFromContent(content)).toBe('Legacy Title')
  })

  it('returns null when the frontmatter title is missing', () => {
    expect(extractFrontmatterTitleFromContent('---\nstatus: Active\n---\n## Body')).toBeNull()
  })
})

describe('deriveDisplayTitleState', () => {
  it('prefers H1 over frontmatter title and filename', () => {
    const content = '---\ntitle: Legacy Title\n---\n# Updated Title\n\nBody'
    expect(deriveDisplayTitleState({ content, filename: 'legacy-title.md', frontmatterTitle: 'Legacy Title' })).toEqual({
      title: 'Updated Title',
      hasH1: true,
    })
  })

  it('falls back to frontmatter title when no H1 is present', () => {
    const content = '---\ntitle: Legacy Title\n---\nBody'
    expect(deriveDisplayTitleState({ content, filename: 'legacy-title.md', frontmatterTitle: 'Legacy Title' })).toEqual({
      title: 'Legacy Title',
      hasH1: false,
    })
  })

  it('reads the frontmatter title from content when no explicit title is passed', () => {
    const content = '---\ntitle: Spring 2026\n---\n## Goals'
    expect(deriveDisplayTitleState({ content, filename: 'spring-2026.md' })).toEqual({
      title: 'Spring 2026',
      hasH1: false,
    })
  })

  it('falls back to filename stem when there is no H1 or frontmatter title', () => {
    expect(deriveDisplayTitleState({ content: 'Body only', filename: 'renamed-note.md' })).toEqual({
      title: 'renamed-note',
      hasH1: false,
    })
  })

  it('keeps plain square brackets when deriving the display title from H1', () => {
    const content = '# [26Q2] Tolaria MVP\n\nBody'
    expect(deriveDisplayTitleState({ content, filename: 'tolaria-mvp.md' })).toEqual({
      title: '[26Q2] Tolaria MVP',
      hasH1: true,
    })
  })
})

describe('syncFilenameDerivedFrontmatterTitle', () => {
  it('rewrites a frontmatter title that mirrors the old filename stem', () => {
    const content = '---\ntitle: 2026-07-13\ntype: Note\n---\n\nBody.\n'
    expect(syncFilenameDerivedFrontmatterTitle(content, '2026-07-13', 'Team Standup Notes'))
      .toBe('---\ntitle: Team Standup Notes\ntype: Note\n---\n\nBody.\n')
  })

  it('leaves an explicit title that differs from the old filename untouched', () => {
    const content = '---\ntitle: Project Kickoff\ntype: Note\n---\n\nBody.\n'
    expect(syncFilenameDerivedFrontmatterTitle(content, 'project-kickoff', 'manual-name')).toBe(content)
  })

  it('is a no-op when the stem does not change', () => {
    const content = '---\ntitle: 2026-07-13\n---\n\nBody.\n'
    expect(syncFilenameDerivedFrontmatterTitle(content, '2026-07-13', '2026-07-13')).toBe(content)
  })

  it('is a no-op when there is no frontmatter title', () => {
    const content = 'Body only'
    expect(syncFilenameDerivedFrontmatterTitle(content, 'old-stem', 'new-stem')).toBe(content)
  })
})
