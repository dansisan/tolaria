/** Note-body font size, in pixels, applied to the rich editor content. */
export const MIN_NOTE_FONT_SIZE = 12
export const MAX_NOTE_FONT_SIZE = 22
export const DEFAULT_NOTE_FONT_SIZE = 15

/** Selectable sizes, smallest first, for the Settings dropdown. */
export const NOTE_FONT_SIZE_OPTIONS: number[] = Array.from(
  { length: MAX_NOTE_FONT_SIZE - MIN_NOTE_FONT_SIZE + 1 },
  (_unused, index) => MIN_NOTE_FONT_SIZE + index,
)

/** Coerce stored input to a supported integer px size, or null when unusable. */
export function normalizeNoteFontSize(value: unknown): number | null {
  const candidate = typeof value === 'string' ? Number(value) : value
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return null
  if (candidate < MIN_NOTE_FONT_SIZE || candidate > MAX_NOTE_FONT_SIZE) return null
  return candidate
}

/** Resolve the effective size: stored value, then fallback, then the default. */
export function resolveNoteFontSize(value: unknown, fallback: unknown): number {
  return normalizeNoteFontSize(value)
    ?? normalizeNoteFontSize(fallback)
    ?? DEFAULT_NOTE_FONT_SIZE
}
