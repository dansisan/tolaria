const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const FILE_SIZE_BASE = 1024

/** Human-readable file size, e.g. 1536 → "1.5 KB". Bytes show no decimal; larger
 *  units keep a single trimmed decimal. Non-positive or non-finite input → "0 B". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(FILE_SIZE_BASE)),
    FILE_SIZE_UNITS.length - 1,
  )
  const value = bytes / FILE_SIZE_BASE ** exponent
  const rounded = exponent === 0 ? value : Math.round(value * 10) / 10
  return `${rounded} ${FILE_SIZE_UNITS[exponent]}`
}
