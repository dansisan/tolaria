import type { Settings, VaultEntry, VaultPropertyValue } from '../types'

/**
 * How many lines of note body a row falls back to when it has no curated
 * description. 0 means no fallback: only curated descriptions ever show.
 */
export type NoteListPreviewLines = 0 | 1 | 2 | 3

export const NOTE_LIST_PREVIEW_LINE_OPTIONS: readonly NoteListPreviewLines[] = [0, 1, 2, 3]

export const DEFAULT_NOTE_LIST_PREVIEW_FALLBACK_LINES: NoteListPreviewLines = 1
export const DEFAULT_NOTE_LIST_DESCRIPTION_PROPERTY = 'description'

export interface NoteListPreview {
  /**
   * Frontmatter key holding a curated, display-ready description. null when no
   * field is configured, in which case rows only ever show the body fallback.
   */
  descriptionProperty: string | null
  fallbackLines: NoteListPreviewLines
}

export const DEFAULT_NOTE_LIST_PREVIEW: NoteListPreview = {
  descriptionProperty: DEFAULT_NOTE_LIST_DESCRIPTION_PROPERTY,
  fallbackLines: DEFAULT_NOTE_LIST_PREVIEW_FALLBACK_LINES,
}

type NoteListPreviewSettings = Pick<
  Settings,
  'note_list_description_property' | 'note_list_preview_fallback_lines'
>

function isNoteListPreviewLines(value: number): value is NoteListPreviewLines {
  return NOTE_LIST_PREVIEW_LINE_OPTIONS.includes(value as NoteListPreviewLines)
}

/** Coerce stored input to a supported line count, or null when unusable. */
export function normalizeNoteListPreviewLines(value: unknown): NoteListPreviewLines | null {
  const candidate = typeof value === 'string' ? Number(value) : value
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return null
  return isNoteListPreviewLines(candidate) ? candidate : null
}

/**
 * What to persist for the description field. The empty string is meaningful and
 * is kept: it records "the user cleared this field", which switches curated
 * descriptions off. `null` means the field was never set, so the default
 * applies. Collapsing the two would make clearing the field impossible.
 */
export function serializeNoteListDescriptionProperty(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

/** The effective key: null when switched off, the default when never set. */
function resolveNoteListDescriptionProperty(value: unknown): string | null {
  const stored = serializeNoteListDescriptionProperty(value)
  if (stored === null) return DEFAULT_NOTE_LIST_DESCRIPTION_PROPERTY
  return stored === '' ? null : stored
}

export function resolveNoteListPreview(
  settings: NoteListPreviewSettings | null | undefined,
): NoteListPreview {
  return {
    descriptionProperty: resolveNoteListDescriptionProperty(settings?.note_list_description_property),
    fallbackLines: normalizeNoteListPreviewLines(settings?.note_list_preview_fallback_lines)
      ?? DEFAULT_NOTE_LIST_PREVIEW_FALLBACK_LINES,
  }
}

/**
 * The Settings-panel edit shape. It holds the field as raw text so a half-typed
 * or cleared key round-trips through the input untouched; `NoteListPreview` is
 * the resolved form the note list renders from.
 */
export interface NoteListPreviewDraft {
  descriptionField: string
  fallbackLines: NoteListPreviewLines
}

export function noteListPreviewDraft(
  settings: NoteListPreviewSettings | null | undefined,
): NoteListPreviewDraft {
  const preview = resolveNoteListPreview(settings)
  return {
    descriptionField: preview.descriptionProperty ?? '',
    fallbackLines: preview.fallbackLines,
  }
}

export function noteListPreviewFromDraft(draft: NoteListPreviewDraft): NoteListPreview {
  const trimmed = draft.descriptionField.trim()
  return {
    descriptionProperty: trimmed === '' ? null : trimmed,
    fallbackLines: draft.fallbackLines,
  }
}

/**
 * Frontmatter keys keep their authored casing, so match case-insensitively.
 * Returns the matched key rather than its value: presence is decided by the key
 * alone, because a blank value is a deliberate "no description here" and must
 * not be confused with the key being absent.
 */
function findPropertyKey(
  properties: Record<string, VaultPropertyValue> | undefined,
  key: string,
): string | undefined {
  if (!properties) return undefined
  const wanted = key.trim().toLowerCase()
  return Object.keys(properties).find((candidate) => candidate.trim().toLowerCase() === wanted)
}

function formatPropertyValue(value: VaultPropertyValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  return String(value)
}

/** Collapse newlines and runs of whitespace so a multi-line value reads as prose. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export interface NoteListPreviewRow {
  text: string
  /**
   * Whether the row must be clamped to the configured line count. The body
   * fallback is machine-extracted, so bounding it keeps rows uniform; a curated
   * description was written to be read, so it always renders in full.
   */
  clamped: boolean
}

function previewRow(text: string, clamped: boolean): NoteListPreviewRow | null {
  const collapsed = collapseWhitespace(text)
  return collapsed === '' ? null : { text: collapsed, clamped }
}

/**
 * The preview for one row, or null when the row has none to show. A note that
 * declares the configured description field decides its own preview —
 * including declaring it blank, which shows nothing. Every other note falls
 * back to the note body.
 */
export function noteListPreviewRow(
  entry: Pick<VaultEntry, 'snippet' | 'properties'>,
  preview: NoteListPreview,
): NoteListPreviewRow | null {
  if (preview.descriptionProperty !== null) {
    const matchedKey = findPropertyKey(entry.properties, preview.descriptionProperty)
    if (matchedKey !== undefined) {
      return previewRow(formatPropertyValue(entry.properties?.[matchedKey]), false)
    }
  }
  if (preview.fallbackLines === 0) return null
  return previewRow(entry.snippet ?? '', true)
}
