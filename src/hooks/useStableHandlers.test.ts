import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStableHandlers } from './useStableHandlers'

describe('useStableHandlers', () => {
  it('keeps wrapper identity stable while always invoking the latest handler', () => {
    const first = vi.fn(() => 'first')
    const second = vi.fn(() => 'second')
    const { result, rerender } = renderHook(
      ({ onPick }: { onPick: (value: number) => string }) => useStableHandlers({ onPick }),
      { initialProps: { onPick: first } },
    )

    const initialWrapper = result.current.onPick
    expect(initialWrapper(7)).toBe('first')
    expect(first).toHaveBeenCalledWith(7)

    rerender({ onPick: second })
    expect(result.current.onPick).toBe(initialWrapper)
    expect(initialWrapper(9)).toBe('second')
    expect(second).toHaveBeenCalledWith(9)
  })

  it('preserves undefined so presence-gated UI stays gated', () => {
    const handler = vi.fn()
    const { result, rerender } = renderHook(
      ({ onMaybe }: { onMaybe?: () => void }) => useStableHandlers({ onMaybe }),
      { initialProps: {} as { onMaybe?: () => void } },
    )

    expect(result.current.onMaybe).toBeUndefined()

    rerender({ onMaybe: handler })
    expect(typeof result.current.onMaybe).toBe('function')
    result.current.onMaybe?.()
    expect(handler).toHaveBeenCalled()

    rerender({})
    expect(result.current.onMaybe).toBeUndefined()
  })

  it('returns the same wrappers object identity when handler identities change', () => {
    const { result, rerender } = renderHook(
      ({ onA, onB }: { onA: () => void; onB: () => void }) => useStableHandlers({ onA, onB }),
      { initialProps: { onA: vi.fn(), onB: vi.fn() } },
    )
    const firstResult = result.current
    rerender({ onA: vi.fn(), onB: vi.fn() })
    expect(result.current).toBe(firstResult)
  })
})
