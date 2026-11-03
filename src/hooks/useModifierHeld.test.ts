import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHeldModifierMode } from './useModifierHeld'

const key = (type: 'keydown' | 'keyup', k: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: k }))
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('useHeldModifierMode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh; Mac OS X')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reports command after a short hold and clears on release', () => {
    const { result } = renderHook(() => useHeldModifierMode())
    act(() => key('keydown', 'Meta'))
    expect(result.current).toBeNull()
    wait(300)
    expect(result.current).toBe('command')
    act(() => key('keyup', 'Meta'))
    expect(result.current).toBeNull()
  })

  it('reports ctrl-alt when Control and Option are held, and falls back when Option is released', () => {
    const { result } = renderHook(() => useHeldModifierMode())
    act(() => key('keydown', 'Control'))
    act(() => key('keydown', 'Alt'))
    wait(300)
    expect(result.current).toBe('ctrl-alt')
    act(() => key('keyup', 'Alt'))
    wait(300)
    expect(result.current).toBeNull()
  })

  it('does not reveal for Command+Option or for Option alone', () => {
    const { result } = renderHook(() => useHeldModifierMode())
    act(() => key('keydown', 'Alt'))
    wait(300)
    expect(result.current).toBeNull()
    act(() => key('keydown', 'Meta'))
    wait(300)
    expect(result.current).toBeNull()
  })

  it('ignores Shift while Command is held', () => {
    const { result } = renderHook(() => useHeldModifierMode())
    act(() => key('keydown', 'Meta'))
    wait(300)
    act(() => key('keydown', 'Shift'))
    wait(300)
    expect(result.current).toBe('command')
  })

  it('does not reveal when a shortcut is executed quickly', () => {
    const { result } = renderHook(() => useHeldModifierMode())
    act(() => key('keydown', 'Meta'))
    act(() => key('keydown', '1'))
    wait(300)
    expect(result.current).toBeNull()
  })
})
