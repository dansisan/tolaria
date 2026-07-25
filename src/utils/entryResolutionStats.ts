import { elapsedSince, isExpensiveCallLoggingEnabled, startExpensiveCall } from './expensiveCallLog'

/**
 * Cumulative cost of `resolveEntry()` calls, drained once per document install.
 *
 * Reporting calls-and-total per swap is what distinguishes "the view has many
 * nodes" from "each node runs a vault scan" — the two need different fixes. The
 * phase breakdown then says *which* part of a resolution costs: `aliasScan`,
 * `candidates`, and `find` are each O(vault entries) and allocate their own arrays,
 * so on a large vault they are the whole cost, and all three are indexable.
 */
export interface EntryResolutionPhases {
  /** Building the workspace-alias Set — one pass over every entry, per call. */
  aliasScanMs: number
  /** Parsing the raw target into a resolution key. No vault access. */
  keyBuildMs: number
  /** Workspace filter + source-workspace prioritisation — up to three passes. */
  candidatesMs: number
  /** The path/filename/alias/title scans — up to five linear searches. */
  findMs: number
}

interface EntryResolutionStats extends EntryResolutionPhases {
  calls: number
  totalMs: number
  /** Vault size seen by the most recent call, so O(entries) is visible in the log. */
  entries: number
}

function emptyStats(): EntryResolutionStats {
  return {
    calls: 0,
    totalMs: 0,
    entries: 0,
    aliasScanMs: 0,
    keyBuildMs: 0,
    candidatesMs: 0,
    findMs: 0,
  }
}

let pending = emptyStats()

/** Whether callers should bother timing their internal phases. */
export function isEntryResolutionMeasured(): boolean {
  return isExpensiveCallLoggingEnabled()
}

/** Wraps one resolution, accumulating its cost. Off entirely unless diagnostics are on. */
export function measureEntryResolution<T>(resolve: () => T): T {
  if (!isExpensiveCallLoggingEnabled()) return resolve()

  const startedAt = startExpensiveCall()
  try {
    return resolve()
  } finally {
    pending.calls += 1
    pending.totalMs += elapsedSince(startedAt)
  }
}

/** Adds one call's phase timings and the vault size it scanned. */
export function recordEntryResolutionPhases(phases: EntryResolutionPhases, entries: number): void {
  if (!isExpensiveCallLoggingEnabled()) return

  pending.aliasScanMs += phases.aliasScanMs
  pending.keyBuildMs += phases.keyBuildMs
  pending.candidatesMs += phases.candidatesMs
  pending.findMs += phases.findMs
  pending.entries = entries
}

/** Returns the stats accumulated since the last drain and resets the counters. */
export function drainEntryResolutionStats(): EntryResolutionStats {
  const drained = pending
  pending = emptyStats()
  return drained
}

export function formatEntryResolutionStats(stats: EntryResolutionStats): string {
  if (stats.calls === 0) return 'resolveEntryCalls=0'
  return `resolveEntryCalls=${stats.calls} resolveEntryTotal=${stats.totalMs.toFixed(1)}ms `
    + `vaultEntries=${stats.entries} aliasScan=${stats.aliasScanMs.toFixed(1)}ms `
    + `keyBuild=${stats.keyBuildMs.toFixed(1)}ms candidates=${stats.candidatesMs.toFixed(1)}ms `
    + `find=${stats.findMs.toFixed(1)}ms`
}
