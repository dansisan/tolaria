import { describe, expect, it } from 'vitest'
import { formatFileSize } from './fileSize'

describe('formatFileSize', () => {
  it('formats zero and non-finite sizes as "0 B"', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(-10)).toBe('0 B')
    expect(formatFileSize(Number.NaN)).toBe('0 B')
  })

  it('formats byte-range sizes without a decimal', () => {
    expect(formatFileSize(1)).toBe('1 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('formats kilobyte-range sizes with one trimmed decimal', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2048)).toBe('2 KB')
  })

  it('formats megabyte and gigabyte sizes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('caps the largest unit instead of inventing new ones', () => {
    expect(formatFileSize(1024 ** 5)).toBe('1024 TB')
  })
})
