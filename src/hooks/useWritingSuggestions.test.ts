import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WRITING_SUGGESTIONS_ATTRIBUTE, useWritingSuggestions } from './useWritingSuggestions'

describe('useWritingSuggestions', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)
  })

  it('disables inline predictions by setting the document attribute to false', () => {
    renderHook(() => useWritingSuggestions(false))
    expect(document.documentElement.getAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)).toBe('false')
  })

  it('leaves the attribute off when suggestions are enabled', () => {
    renderHook(() => useWritingSuggestions(true))
    expect(document.documentElement.hasAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)).toBe(false)
  })

  it('removes the attribute when toggled back on', () => {
    const { rerender } = renderHook(({ on }: { on: boolean }) => useWritingSuggestions(on), {
      initialProps: { on: false },
    })
    expect(document.documentElement.getAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)).toBe('false')

    rerender({ on: true })
    expect(document.documentElement.hasAttribute(WRITING_SUGGESTIONS_ATTRIBUTE)).toBe(false)
  })
})
