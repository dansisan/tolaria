import { parseDashDateParts, parseSlashDateParts, type DateParts } from './dateStringParts'

export type DateDisplayFormat = 'us' | 'european' | 'friendly' | 'iso'

export const DEFAULT_DATE_DISPLAY_FORMAT: DateDisplayFormat = 'friendly'
export const DATE_DISPLAY_FORMATS: readonly DateDisplayFormat[] = ['us', 'european', 'friendly', 'iso']

const FRIENDLY_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function isDateDisplayFormat(value: string): value is DateDisplayFormat {
  return DATE_DISPLAY_FORMATS.includes(value as DateDisplayFormat)
}

export function normalizeDateDisplayFormat(value: unknown): DateDisplayFormat | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return isDateDisplayFormat(normalized) ? normalized : null
}

function twoDigit(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatLocalISODatetime(date: Date): string {
  return `${date.getFullYear()}-${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())} ${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`
}

export function formatDatePartsForDisplay(
  parts: DateParts,
  format: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
): string {
  if (format === 'us') return `${parts.month}/${parts.day}/${parts.year}`
  if (format === 'european') return `${parts.day}/${parts.month}/${parts.year}`
  if (format === 'iso') return `${parts.year}-${twoDigit(parts.month)}-${twoDigit(parts.day)}`
  return `${FRIENDLY_MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function datePartsFromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }
}

export function formatDateForDisplay(
  date: Date,
  format: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
  includeWeekday = false,
): string {
  const formatted = formatDatePartsForDisplay(datePartsFromDate(date), format)
  return includeWeekday ? `${WEEKDAYS_SHORT[date.getDay()]}, ${formatted}` : formatted
}

export function formatTimestampForDateDisplay(
  timestampSeconds: number | null | undefined,
  format: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
  includeWeekday = false,
): string {
  if (!timestampSeconds) return ''
  return formatDateForDisplay(new Date(timestampSeconds * 1000), format, includeWeekday)
}

export function parseDateDisplayParts(value: string): DateParts | null {
  return parseDashDateParts(value) ?? parseSlashDateParts(value)
}

export function formatDateValueForDisplay(
  value: string,
  format: DateDisplayFormat = DEFAULT_DATE_DISPLAY_FORMAT,
): string {
  const parts = parseDateDisplayParts(value)
  return parts ? formatDatePartsForDisplay(parts, format) : value
}
