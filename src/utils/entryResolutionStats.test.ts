import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  drainEntryResolutionStats,
  formatEntryResolutionStats,
  isEntryResolutionMeasured,
  measureEntryResolution,
  recordEntryResolutionPhases,
} from './entryResolutionStats'
import { setExpensiveCallLogging } from './expensiveCallLog'

const NO_PHASES = { aliasScanMs: 0, keyBuildMs: 0, candidatesMs: 0, findMs: 0 }

describe('entryResolutionStats', () => {
  beforeEach(() => {
    setExpensiveCallLogging(true)
    drainEntryResolutionStats()
  })

  afterEach(() => {
    setExpensiveCallLogging(null)
    drainEntryResolutionStats()
    vi.restoreAllMocks()
  })

  it('returns the resolution result unchanged', () => {
    expect(measureEntryResolution(() => 'entry')).toBe('entry')
  })

  it('accumulates call count and total time across resolutions', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(105)

    measureEntryResolution(() => 'a')
    measureEntryResolution(() => 'b')

    const drained = drainEntryResolutionStats()
    expect(drained.calls).toBe(2)
    expect(drained.totalMs).toBe(15)
  })

  it('counts a resolution that throws, then rethrows', () => {
    expect(() => measureEntryResolution(() => {
      throw new Error('resolution failed')
    })).toThrow('resolution failed')

    expect(drainEntryResolutionStats().calls).toBe(1)
  })

  it('sums phase timings across calls and keeps the vault size', () => {
    recordEntryResolutionPhases({ aliasScanMs: 1.5, keyBuildMs: 0.1, candidatesMs: 0.4, findMs: 2 }, 9000)
    recordEntryResolutionPhases({ aliasScanMs: 1, keyBuildMs: 0.1, candidatesMs: 0.6, findMs: 3 }, 9000)

    const drained = drainEntryResolutionStats()
    expect(drained.aliasScanMs).toBeCloseTo(2.5)
    expect(drained.candidatesMs).toBeCloseTo(1)
    expect(drained.findMs).toBe(5)
    expect(drained.entries).toBe(9000)
  })

  it('resets counters on drain so counts belong to one install', () => {
    measureEntryResolution(() => 'a')
    recordEntryResolutionPhases({ ...NO_PHASES, findMs: 4 }, 100)
    drainEntryResolutionStats()

    const drained = drainEntryResolutionStats()
    expect(drained.calls).toBe(0)
    expect(drained.findMs).toBe(0)
    expect(drained.entries).toBe(0)
  })

  it('does not count resolutions or phases while diagnostics are off', () => {
    setExpensiveCallLogging(false)

    expect(isEntryResolutionMeasured()).toBe(false)
    expect(measureEntryResolution(() => 'entry')).toBe('entry')
    recordEntryResolutionPhases({ ...NO_PHASES, findMs: 99 }, 500)

    const drained = drainEntryResolutionStats()
    expect(drained.calls).toBe(0)
    expect(drained.findMs).toBe(0)
  })

  it('formats the drained stats with their phase breakdown', () => {
    recordEntryResolutionPhases(
      { aliasScanMs: 400.4, keyBuildMs: 3.2, candidatesMs: 120.5, findMs: 88.1 },
      9039,
    )
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(612.34)
    measureEntryResolution(() => 'entry')

    expect(formatEntryResolutionStats(drainEntryResolutionStats())).toBe(
      'resolveEntryCalls=1 resolveEntryTotal=612.3ms vaultEntries=9039 aliasScan=400.4ms '
      + 'keyBuild=3.2ms candidates=120.5ms find=88.1ms',
    )
  })

  it('reports just the zero count when nothing resolved', () => {
    expect(formatEntryResolutionStats(drainEntryResolutionStats())).toBe('resolveEntryCalls=0')
  })
})
