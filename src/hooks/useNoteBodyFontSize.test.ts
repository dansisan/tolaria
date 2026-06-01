import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NOTE_BODY_FONT_SIZE_PROPERTY, useNoteBodyFontSize } from './useNoteBodyFontSize'

function readFontSizeVar(): string {
  return document.documentElement.style.getPropertyValue(NOTE_BODY_FONT_SIZE_PROPERTY)
}

describe('useNoteBodyFontSize', () => {
  it('publishes the configured size as a px CSS variable on the document root', () => {
    renderHook(() => useNoteBodyFontSize(18))
    expect(readFontSizeVar()).toBe('18px')
  })

  it('updates the variable when the size changes', () => {
    const { rerender } = renderHook(({ size }) => useNoteBodyFontSize(size), {
      initialProps: { size: 14 },
    })
    expect(readFontSizeVar()).toBe('14px')

    rerender({ size: 20 })
    expect(readFontSizeVar()).toBe('20px')
  })
})
