/** Code font size, in pixels, applied to code blocks and inline code in the rich editor. */
export const MIN_CODE_FONT_SIZE = 10
export const MAX_CODE_FONT_SIZE = 22

/** Selectable sizes, smallest first, for the Settings dropdown. */
export const CODE_FONT_SIZE_OPTIONS: number[] = Array.from(
  { length: MAX_CODE_FONT_SIZE - MIN_CODE_FONT_SIZE + 1 },
  (_unused, index) => MIN_CODE_FONT_SIZE + index,
)

/**
 * Coerce stored input to a supported integer px size, or null when unusable.
 * Null means "no override": inline code keeps the theme size and code blocks
 * follow the note-body size.
 */
export function normalizeCodeFontSize(value: unknown): number | null {
  const candidate = typeof value === 'string' ? Number(value) : value
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return null
  if (candidate < MIN_CODE_FONT_SIZE || candidate > MAX_CODE_FONT_SIZE) return null
  return candidate
}
