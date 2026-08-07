// Mirrors src-tauri/src/vault/filename_rules.rs so a title typed with
// path-unsafe characters gets cleaned up instead of failing the rename. The
// backend still validates — this keeps the user from hitting that wall.
const UNSAFE_STEM_CHARS = /[<>:"/\\|?*\p{Cc}]/gu

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
])

/** Windows treats `con` and `con.backup` alike, so only the first segment matters. */
function escapeReservedDeviceName(stem: string): string {
  const [head, ...rest] = stem.split('.')
  if (!WINDOWS_RESERVED_DEVICE_NAMES.has(head.toUpperCase())) return stem
  return [`${head}_`, ...rest].join('.')
}

/**
 * Drop the characters a portable filename cannot hold while keeping spaces and
 * case, so a cleaned stem still reads like what the user typed. Returns `''`
 * when nothing usable survives — callers decide whether to skip the rename or
 * fall back to a slug.
 */
export function sanitizeFilenameStem(value: string): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(UNSAFE_STEM_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots and spaces are legal to type but not to store on Windows.
    .replace(/\.+$/, '')
    .trim()
  return cleaned ? escapeReservedDeviceName(cleaned) : ''
}
