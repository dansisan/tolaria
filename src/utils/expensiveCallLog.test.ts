import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  elapsedSince,
  isExpensiveCallLoggingEnabled,
  logExpensiveCall,
  resetExpensiveCallLog,
  setExpensiveCallLogging,
  startExpensiveCall,
} from './expensiveCallLog'
import { APP_STORAGE_KEYS } from '../constants/appStorage'

describe('expensiveCallLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetExpensiveCallLog()
    localStorage.clear()
    setExpensiveCallLogging(true)
  })

  afterEach(() => {
    setExpensiveCallLogging(null)
    vi.restoreAllMocks()
  })

  it('logs duration, call count and detail for a single expensive call', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(142.5)

    const startedAt = startExpensiveCall()
    logExpensiveCall({ name: 'vault.scan', startedAt, detail: 'entries=1200' })

    expect(debugSpy).toHaveBeenCalledWith('[perf] expensive vault.scan took=42.5ms calls=1 entries=1200')
  })

  it('marks a repeat inside the burst window', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(30)

    logExpensiveCall({ name: 'vault.scan', startedAt: startExpensiveCall() })
    logExpensiveCall({ name: 'vault.scan', startedAt: startExpensiveCall() })

    // Dev warns so the repeat is impossible to miss; a release build keeps it on
    // debug to stay out of the feedback-diagnostics warn buffer.
    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[perf] expensive vault.scan took=10.0ms calls=2 sinceLast=20.0ms repeat=burst',
    )
  })

  it('does not mark repeats spaced beyond the burst window', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1005)

    logExpensiveCall({ name: 'vault.scan', startedAt: startExpensiveCall() })
    logExpensiveCall({ name: 'vault.scan', startedAt: startExpensiveCall() })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(debugSpy).toHaveBeenLastCalledWith(
      '[perf] expensive vault.scan took=5.0ms calls=2 sinceLast=1000.0ms',
    )
  })

  it('keeps call counts separate per key so per-item work is not flagged as a burst', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValue(0)

    logExpensiveCall({ name: 'noteList.filterView', key: 'noteList.filterView:a', startedAt: 0 })
    logExpensiveCall({ name: 'noteList.filterView', key: 'noteList.filterView:b', startedAt: 0 })

    expect(warnSpy).not.toHaveBeenCalled()
    expect(debugSpy).toHaveBeenCalledTimes(2)
    expect(debugSpy).toHaveBeenLastCalledWith('[perf] expensive noteList.filterView took=0.0ms calls=1')
  })

  it('keeps counting while emission is off so the count is still right once enabled', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValue(0)

    setExpensiveCallLogging(false)
    logExpensiveCall({ name: 'vault.scan', startedAt: 0 })
    logExpensiveCall({ name: 'vault.scan', startedAt: 0 })
    expect(debugSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()

    setExpensiveCallLogging(true)
    logExpensiveCall({ name: 'vault.scan', startedAt: 0 })

    expect(warnSpy).toHaveBeenCalledWith('[perf] expensive vault.scan took=0.0ms calls=3 sinceLast=0.0ms repeat=burst')
  })

  it('measures elapsed phase time from a start timestamp', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(500).mockReturnValueOnce(512.5)

    const startedAt = startExpensiveCall()
    expect(elapsedSince(startedAt)).toBe(12.5)
  })

  it('stays silent under the vitest runtime unless explicitly enabled', () => {
    setExpensiveCallLogging(null)
    expect(isExpensiveCallLoggingEnabled()).toBe(false)
  })

  it('emits when the perf-logging opt-in is set, which is how release builds are read', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValue(0)
    setExpensiveCallLogging(null)
    localStorage.setItem(APP_STORAGE_KEYS.perfLogging, '1')

    expect(isExpensiveCallLoggingEnabled()).toBe(true)

    logExpensiveCall({ name: 'vault.scan', startedAt: 0 })
    expect(debugSpy).toHaveBeenCalledWith('[perf] expensive vault.scan took=0.0ms calls=1')
  })
})
