import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTE_LIST_PREVIEW,
  noteListPreviewRow,
  normalizeNoteListPreviewLines,
  resolveNoteListPreview,
  serializeNoteListDescriptionProperty,
} from './noteListPreview'

describe('normalizeNoteListPreviewLines', () => {
  it('accepts the offered counts', () => {
    expect(normalizeNoteListPreviewLines(0)).toBe(0)
    expect(normalizeNoteListPreviewLines(3)).toBe(3)
  })

  it('accepts numeric strings from the select control', () => {
    expect(normalizeNoteListPreviewLines('2')).toBe(2)
  })

  it('rejects out-of-range, fractional, and non-numeric input', () => {
    expect(normalizeNoteListPreviewLines(4)).toBeNull()
    expect(normalizeNoteListPreviewLines(-1)).toBeNull()
    expect(normalizeNoteListPreviewLines(1.5)).toBeNull()
    expect(normalizeNoteListPreviewLines('many')).toBeNull()
    expect(normalizeNoteListPreviewLines(null)).toBeNull()
  })
})

describe('serializeNoteListDescriptionProperty', () => {
  it('trims a key and keeps a cleared field as the empty string', () => {
    expect(serializeNoteListDescriptionProperty('  Summary ')).toBe('Summary')
    expect(serializeNoteListDescriptionProperty('   ')).toBe('')
    expect(serializeNoteListDescriptionProperty('')).toBe('')
  })

  it('reports never-set values as null', () => {
    expect(serializeNoteListDescriptionProperty(null)).toBeNull()
    expect(serializeNoteListDescriptionProperty(undefined)).toBeNull()
    expect(serializeNoteListDescriptionProperty(42)).toBeNull()
  })
})

describe('resolveNoteListPreview', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(resolveNoteListPreview(null)).toEqual(DEFAULT_NOTE_LIST_PREVIEW)
    expect(resolveNoteListPreview({
      note_list_description_property: null,
      note_list_preview_fallback_lines: null,
    })).toEqual({ descriptionProperty: 'description', fallbackLines: 1 })
  })

  it('reads stored preferences, trimming the key', () => {
    expect(resolveNoteListPreview({
      note_list_description_property: '  Summary  ',
      note_list_preview_fallback_lines: 3,
    })).toEqual({ descriptionProperty: 'Summary', fallbackLines: 3 })
  })

  it('keeps a cleared description field off after a reload', () => {
    expect(resolveNoteListPreview({
      note_list_description_property: '',
      note_list_preview_fallback_lines: 2,
    })).toEqual({ descriptionProperty: null, fallbackLines: 2 })
  })

  it('repairs an unsupported stored line count', () => {
    expect(resolveNoteListPreview({ note_list_preview_fallback_lines: 9 }).fallbackLines).toBe(1)
  })
})

const entry = {
  snippet: 'Body snippet text.',
  properties: { Description: 'From frontmatter.' },
}

const PREVIEW = { descriptionProperty: 'description', fallbackLines: 2 } as const

describe('noteListPreviewRow', () => {
  it('shows a curated description in full, never clamped', () => {
    expect(noteListPreviewRow(entry, PREVIEW)).toEqual({ text: 'From frontmatter.', clamped: false })
  })

  it('does not clamp even a very long curated description', () => {
    const long = 'word '.repeat(200).trim()
    expect(noteListPreviewRow({ snippet: '', properties: { description: long } }, PREVIEW))
      .toEqual({ text: long, clamped: false })
  })

  it('matches the configured key case-insensitively', () => {
    expect(noteListPreviewRow(entry, { ...PREVIEW, descriptionProperty: 'DESCRIPTION' })?.text)
      .toBe('From frontmatter.')
  })

  it('falls back to the clamped body snippet when the note omits the field', () => {
    expect(noteListPreviewRow(entry, { ...PREVIEW, descriptionProperty: 'summary' }))
      .toEqual({ text: 'Body snippet text.', clamped: true })
  })

  it('shows nothing when the note declares the field blank', () => {
    for (const value of ['   ', '', null, []] as const) {
      expect(noteListPreviewRow(
        { snippet: 'Body snippet text.', properties: { description: value } },
        PREVIEW,
      )).toBeNull()
    }
  })

  it('uses the body fallback for every note when no field is configured', () => {
    expect(noteListPreviewRow(entry, { descriptionProperty: null, fallbackLines: 2 }))
      .toEqual({ text: 'Body snippet text.', clamped: true })
  })

  it('shows nothing at all when the fallback is off and the note has no description', () => {
    expect(noteListPreviewRow(entry, { descriptionProperty: 'summary', fallbackLines: 0 })).toBeNull()
  })

  it('shows nothing when the note has no description and no body snippet', () => {
    expect(noteListPreviewRow({ snippet: '', properties: {} }, PREVIEW)).toBeNull()
  })

  it('still shows a curated description when the fallback is off', () => {
    expect(noteListPreviewRow(entry, { descriptionProperty: 'description', fallbackLines: 0 }))
      .toEqual({ text: 'From frontmatter.', clamped: false })
  })

  it('formats non-string property values', () => {
    expect(noteListPreviewRow({ snippet: '', properties: { description: ['one', 'two'] } }, PREVIEW)?.text)
      .toBe('one, two')
    expect(noteListPreviewRow({ snippet: '', properties: { description: 7 } }, PREVIEW)?.text).toBe('7')
  })

  it('collapses newlines in a multi-line description', () => {
    expect(noteListPreviewRow(
      { snippet: '', properties: { description: 'first line\n\nsecond   line' } },
      PREVIEW,
    )?.text).toBe('first line second line')
  })
})
