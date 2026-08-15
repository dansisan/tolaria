import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitCommit } from '../types'
import { useGitHistory } from './useGitHistory'

const mockHistory: GitCommit[] = [
  { hash: 'abc', shortHash: 'abc', author: 'luca', date: 1_700_000_000, message: 'Initial commit' },
]

describe('useGitHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits briefly before loading note history', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result } = renderHook(() => useGitHistory('/vault/a.md', loadGitHistory, true))

    expect(result.current).toEqual([])
    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(loadGitHistory).toHaveBeenCalledWith('/vault/a.md')
    expect(result.current).toEqual(mockHistory)
  })

  it('skips loading when history is disabled', () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result } = renderHook(() => useGitHistory('/vault/a.md', loadGitHistory, false))

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()
    expect(result.current).toEqual([])
  })

  it('cancels stale pending loads when the active note changes quickly', async () => {
    const loadGitHistory = vi.fn((path: string) => Promise.resolve([
      { ...mockHistory[0], hash: path, shortHash: path, message: path },
    ]))

    const { result, rerender } = renderHook(
      ({ path }) => useGitHistory(path, loadGitHistory, true),
      { initialProps: { path: '/vault/a.md' as string | null } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    rerender({ path: '/vault/b.md' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })

    expect(loadGitHistory).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(loadGitHistory).toHaveBeenCalledTimes(1)
    expect(loadGitHistory).toHaveBeenCalledWith('/vault/b.md')
    expect(result.current).toEqual([
      expect.objectContaining({ hash: '/vault/b.md', message: '/vault/b.md' }),
    ])
  })

  it('keeps a pending load alive when the loader identity churns', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result, rerender } = renderHook(
      ({ load }) => useGitHistory('/vault/a.md', load, true),
      { initialProps: { load: loadGitHistory } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    // A git status poll rebuilds the loader. That must not restart the debounce,
    // or a vault with pending changes never settles long enough to load.
    const rebuiltLoader = vi.fn().mockResolvedValue(mockHistory)
    rerender({ load: rebuiltLoader })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(rebuiltLoader).toHaveBeenCalledWith('/vault/a.md')
    expect(loadGitHistory).not.toHaveBeenCalled()
    expect(result.current).toEqual(mockHistory)
  })

  it('reloads history when a new commit lands', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { rerender } = renderHook(
      ({ commit }) => useGitHistory('/vault/a.md', loadGitHistory, true, commit),
      { initialProps: { commit: 'abc1234' } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(loadGitHistory).toHaveBeenCalledTimes(1)

    rerender({ commit: 'def5678' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(loadGitHistory).toHaveBeenCalledTimes(2)
  })

  it('clears previously loaded history when the inspector is hidden', async () => {
    const loadGitHistory = vi.fn().mockResolvedValue(mockHistory)

    const { result, rerender } = renderHook(
      ({ enabled }) => useGitHistory('/vault/a.md', loadGitHistory, enabled),
      { initialProps: { enabled: true } },
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(result.current).toEqual(mockHistory)

    rerender({ enabled: false })

    expect(result.current).toEqual([])
  })
})
