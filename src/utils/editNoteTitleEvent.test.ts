import { describe, it, expect } from 'vitest'
import { shouldEnterTitleEditOnArrowUp, type TitleEditArrowContext } from './editNoteTitleEvent'

const base: TitleEditArrowContext = {
  key: 'ArrowUp',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  selectionEmpty: true,
  atTopLine: true,
  inFirstBlock: true,
}

describe('shouldEnterTitleEditOnArrowUp', () => {
  it('enters title edit on a plain Up at the top of the first block', () => {
    expect(shouldEnterTitleEditOnArrowUp(base)).toBe(true)
  })

  it('ignores other keys and modifier chords', () => {
    expect(shouldEnterTitleEditOnArrowUp({ ...base, key: 'ArrowDown' })).toBe(false)
    expect(shouldEnterTitleEditOnArrowUp({ ...base, shiftKey: true })).toBe(false)
    expect(shouldEnterTitleEditOnArrowUp({ ...base, metaKey: true })).toBe(false)
    expect(shouldEnterTitleEditOnArrowUp({ ...base, altKey: true })).toBe(false)
    expect(shouldEnterTitleEditOnArrowUp({ ...base, isComposing: true })).toBe(false)
  })

  it('does not hijack when the caret is not at the top of the first block', () => {
    expect(shouldEnterTitleEditOnArrowUp({ ...base, atTopLine: false })).toBe(false)
    expect(shouldEnterTitleEditOnArrowUp({ ...base, inFirstBlock: false })).toBe(false)
  })

  it('does not hijack when text is selected', () => {
    expect(shouldEnterTitleEditOnArrowUp({ ...base, selectionEmpty: false })).toBe(false)
  })
})
