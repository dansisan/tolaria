import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CODE_LINE_NUMBERS_ATTRIBUTE, useCodeLineNumbers } from './useCodeLineNumbers'

describe('useCodeLineNumbers', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)
  })

  it('sets the document attribute when line numbers are enabled', () => {
    renderHook(() => useCodeLineNumbers(true))
    expect(document.documentElement.getAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)).toBe('true')
  })

  it('leaves the attribute off when disabled', () => {
    renderHook(() => useCodeLineNumbers(false))
    expect(document.documentElement.hasAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)).toBe(false)
  })

  it('removes the attribute when toggled back off', () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => useCodeLineNumbers(on), {
      initialProps: { on: true },
    })
    expect(document.documentElement.hasAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)).toBe(true)

    rerender({ on: false })
    expect(document.documentElement.hasAttribute(CODE_LINE_NUMBERS_ATTRIBUTE)).toBe(false)
  })
})
