import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { isExpensiveCallLoggingEnabled } from '../utils/expensiveCallLog'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'

/**
 * Diagnostic probe for splitting a slow document install into JS versus layout.
 *
 * `view.updateState()` both builds DOM and can force a synchronous reflow by
 * reading geometry, and the two are indistinguishable from the outside — yet they
 * call for opposite fixes (retaining rendered views versus rendering less). With
 * the editor container at `display: none` the browser skips layout entirely, so
 * running the same install hidden and comparing timings separates them: a
 * `viewUpdate` that stays slow while hidden is ProseMirror's own work.
 *
 * Opt-in per installation, and only while perf logging is on, because hiding the
 * container mid-swap can flash:
 *
 *     localStorage.setItem('tolaria:perf-swap-hidden', '1')
 */
export function isSwapHiddenProbeEnabled(): boolean {
  if (!isExpensiveCallLoggingEnabled()) return false
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.perfSwapHiddenProbe) === '1'
  } catch {
    return false
  }
}

function editorContainerElement(): HTMLElement | null {
  const element = document.querySelector(EDITOR_CONTAINER_SELECTOR)
  return element instanceof HTMLElement ? element : null
}

/**
 * Runs `install` with the editor container hidden when the probe is enabled, always
 * restoring the previous display value. Reports whether it actually ran hidden so
 * the log line can say which measurement it is.
 */
export function withSwapHiddenProbe<T>(install: () => T): { value: T; hidden: boolean } {
  if (!isSwapHiddenProbeEnabled()) return { value: install(), hidden: false }

  const container = editorContainerElement()
  if (!container) return { value: install(), hidden: false }

  const previousDisplay = container.style.display
  container.style.display = 'none'
  try {
    return { value: install(), hidden: true }
  } finally {
    container.style.display = previousDisplay
  }
}
