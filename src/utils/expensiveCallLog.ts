import { APP_STORAGE_KEYS } from '../constants/appStorage'

/**
 * Instrumentation for operations expensive enough that an unexpected repeat call
 * is itself a performance bug: full-vault scans, whole-note markdown parses and
 * serializations, and vault-wide link-graph builds.
 *
 * Every log line carries the duration, how many times the operation has run since
 * app start, and how long it has been since the previous run, so a burst of
 * redundant calls (a cache that stopped hitting, a render loop, a dependency that
 * changed identity) is visible in the console without attaching a profiler.
 *
 * ## Measurement is always on, emission is opt-in outside dev
 *
 * Two `performance.now()` reads plus a `Map` update measured ~0.14µs per call with
 * emission off (200k iterations, jsdom), against operations that take tens to
 * hundreds of milliseconds — five to six orders of magnitude apart, so measuring in
 * release builds is free in practice. It is also the only way to get trustworthy
 * numbers: dev builds run under React `StrictMode` (every effect-driven operation
 * runs twice on mount), unminified React, and unbundled Vite modules, so dev
 * timings are inflated and dev call counts are doubled.
 *
 * Release builds ship the Tauri `devtools` feature, so to read these in prod:
 *
 *     localStorage.setItem('tolaria:perf-logging', '1')  // then reload
 *
 * Outside dev everything goes to `console.debug`, never `console.warn`:
 * `startFeedbackDiagnosticsCapture()` patches `console.warn` into an 8-entry ring
 * buffer that ships with user feedback bundles, and perf chatter would evict the
 * real errors from it.
 */

interface ExpensiveCallRecord {
  count: number
  lastCalledAt: number
}

interface ExpensiveCallLog {
  /** Stable operation label, e.g. `editor.parseMarkdownToBlocks`. */
  name: string
  /** Timestamp from `startExpensiveCall()`. */
  startedAt: number
  /** Extra context appended verbatim, e.g. `chars=1200 blocks=48`. */
  detail?: string
  /** Call-count/burst bucket. Defaults to `name`; pass a narrower key when one
   * operation legitimately runs once per item (per view, per pane) so repeats of
   * the *same* item are what gets flagged. */
  key?: string
}

/** Running the same expensive operation twice inside this window is a smell.
 * Kept tight so ordinary loading-state transitions (empty list → loaded list a
 * few hundred ms later) stay at debug level and only true repeats are marked. */
const BURST_WINDOW_MS = 100

/** Defensive ceiling on distinct keys so a pathological key (an unbounded path,
 * say) cannot grow this map for the lifetime of the process. */
const MAX_TRACKED_KEYS = 200

const callRecords = new Map<string, ExpensiveCallRecord>()

let consoleEmissionOverride: boolean | null = null

function isVitestRuntime(): boolean {
  return '__vitest_worker__' in globalThis
}

function isPerfLoggingOptedIn(): boolean {
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.perfLogging) === '1'
  } catch {
    return false
  }
}

/** Whether log lines reach the console. Measurement happens either way. */
export function isExpensiveCallLoggingEnabled(): boolean {
  if (consoleEmissionOverride !== null) return consoleEmissionOverride
  // An explicit opt-in wins everywhere; otherwise dev logs and release builds stay
  // quiet, and tests stay quiet so they never assert on incidental perf chatter.
  if (isPerfLoggingOptedIn()) return true
  if (isVitestRuntime()) return false
  return import.meta.env.DEV
}

/** Forces console emission on or off for the current session; `null` restores the
 * default (dev, or the `tolaria:perf-logging` opt-in). Mainly a test seam, but
 * also the way to flip logging from a devtools console without a reload. */
export function setExpensiveCallLogging(enabled: boolean | null): void {
  consoleEmissionOverride = enabled
}

/** Start timestamp for an expensive operation. */
export function startExpensiveCall(): number {
  return typeof performance === 'undefined' ? 0 : performance.now()
}

function recordCall(key: string, finishedAt: number): { count: number; sinceLast: number | null } {
  const previous = callRecords.get(key)
  const count = (previous?.count ?? 0) + 1
  const sinceLast = previous ? finishedAt - previous.lastCalledAt : null
  if (previous || callRecords.size < MAX_TRACKED_KEYS) {
    callRecords.set(key, { count, lastCalledAt: finishedAt })
  }
  return { count, sinceLast }
}

function formatMessage(options: {
  log: ExpensiveCallLog
  durationMs: number
  count: number
  sinceLast: number | null
}): string {
  const { log, durationMs, count, sinceLast } = options
  const parts = [`[perf] expensive ${log.name}`, `took=${durationMs.toFixed(1)}ms`, `calls=${count}`]
  if (sinceLast !== null) parts.push(`sinceLast=${sinceLast.toFixed(1)}ms`)
  if (log.detail) parts.push(log.detail)
  return parts.join(' ')
}

function emit(message: string, isBurst: boolean): void {
  if (!isBurst) {
    console.debug(message)
    return
  }
  const burstMessage = `${message} repeat=burst`
  // Dev only for console.warn: see the feedback-diagnostics note in the header.
  if (import.meta.env.DEV) {
    console.warn(burstMessage)
    return
  }
  console.debug(burstMessage)
}

export function logExpensiveCall(log: ExpensiveCallLog): void {
  const finishedAt = startExpensiveCall()
  const { count, sinceLast } = recordCall(log.key ?? log.name, finishedAt)
  if (!isExpensiveCallLoggingEnabled()) return

  emit(
    formatMessage({ log, durationMs: finishedAt - log.startedAt, count, sinceLast }),
    sinceLast !== null && sinceLast < BURST_WINDOW_MS,
  )
}

/** Clears accumulated call counts. Exists for tests; the app never resets. */
export function resetExpensiveCallLog(): void {
  callRecords.clear()
}
