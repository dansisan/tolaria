import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommandKeyHeld } from './useModifierHeld'

const key = (type: 'keydown' | 'keyup', k: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: k }))

describe('useCommandKeyHeld', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh; Mac OS X')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('turns true after a short hold and false on release', () => {
    const { result } = renderHook(() => useCommandKeyHeld())
    act(() => key('keydown', 'Meta'))
    expect(result.current).toBe(false)
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe(true)
    act(() => key('keyup', 'Meta'))
    expect(result.current).toBe(false)
  })

  it('does not reveal when a shortcut is executed quickly', () => {
    const { result } = renderHook(() => useCommandKeyHeld())
    act(() => key('keydown', 'Meta'))
    act(() => key('keydown', '1'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe(false)
  })
})
