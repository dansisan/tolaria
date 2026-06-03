import { describe, it, expect } from 'vitest'
import { normalizeImageRenameMode, resolveImageRenameCommand } from './imageRename'

describe('imageRename', () => {
  it('normalizes the mode, defaulting unknown values to off', () => {
    expect(normalizeImageRenameMode('command')).toBe('command')
    expect(normalizeImageRenameMode('off')).toBe('off')
    expect(normalizeImageRenameMode(null)).toBe('off')
    expect(normalizeImageRenameMode('bogus')).toBe('off')
  })

  it('resolves the command only when mode is command and a command is set', () => {
    expect(resolveImageRenameCommand('command', '~/bin/name-image.sh')).toBe('~/bin/name-image.sh')
    expect(resolveImageRenameCommand('command', '  spaced  ')).toBe('spaced')
  })

  it('returns null when off, empty, or non-string', () => {
    expect(resolveImageRenameCommand('off', '~/bin/name-image.sh')).toBeNull()
    expect(resolveImageRenameCommand('command', '   ')).toBeNull()
    expect(resolveImageRenameCommand('command', null)).toBeNull()
  })
})
