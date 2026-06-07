import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CODE_FONT_SIZE_PROPERTY, useCodeFontSize } from './useCodeFontSize'

describe('useCodeFontSize', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(CODE_FONT_SIZE_PROPERTY)
  })

  it('publishes the configured size as a document-level CSS property', () => {
    renderHook(() => useCodeFontSize(13))
    expect(document.documentElement.style.getPropertyValue(CODE_FONT_SIZE_PROPERTY)).toBe('13px')
  })

  it('removes the property when no size is configured so theme defaults apply', () => {
    const { rerender } = renderHook(({ size }: { size: number | null }) => useCodeFontSize(size), {
      initialProps: { size: 14 as number | null },
    })
    expect(document.documentElement.style.getPropertyValue(CODE_FONT_SIZE_PROPERTY)).toBe('14px')

    rerender({ size: null })
    expect(document.documentElement.style.getPropertyValue(CODE_FONT_SIZE_PROPERTY)).toBe('')
  })
})
