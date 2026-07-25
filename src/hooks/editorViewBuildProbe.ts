import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { elapsedSince, isExpensiveCallLoggingEnabled, startExpensiveCall } from '../utils/expensiveCallLog'

/**
 * Answers what a slow `view.updateState()` is actually spending time on, by
 * building the same document into a throwaway detached view with **no plugins**.
 *
 * That measures the irreducible part: ProseMirror creating one view descriptor and
 * DOM node per document node, with none of our decorations, extensions, or
 * BlockNote node views involved. Comparing it against the real `viewUpdate` splits
 * the cost cleanly:
 *
 *   - core ≈ viewUpdate → the cost is intrinsic to the node count, so the answer is
 *     to stop rebuilding (retain a view per note) or to reduce nodes.
 *   - core ≪ viewUpdate → the cost is our plugins/decorations/node views, and the
 *     answer is to make those cheaper.
 *
 * The probe runs with no plugins deliberately: reusing the live plugin instances in
 * a second view can disturb plugins that hold view-level singletons. The host
 * element is never attached to the document, so no layout happens either.
 *
 * Opt-in, because it rebuilds the whole document a second time:
 *
 *     localStorage.setItem('tolaria:perf-view-build', '1')
 */
export function isViewBuildProbeEnabled(): boolean {
  if (!isExpensiveCallLoggingEnabled()) return false
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.perfViewBuild) === '1'
  } catch {
    return false
  }
}

export interface ViewBuildMeasurement {
  /** Building the whole view detached from the document. */
  coreMs: number
  /** Inserting that already-built subtree into the live document, in one call. */
  attachMs: number
  /** Laying out the newly attached subtree — separate, since it dwarfs the insert. */
  attachLayoutMs: number
  /** Removing it again, in one detach. */
  detachMs: number
}

/** Off-screen host: attached to the live document so style resolution happens, but
 * taken out of flow and hidden so it cannot disturb what the user sees. */
function offscreenHost(): HTMLElement {
  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.top = '-99999px'
  host.style.left = '0'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  return host
}

/**
 * Measures the alternative to rebuilding in place: build the document's view
 * detached, then attach the finished subtree in a single DOM insertion.
 *
 * A live `updateState` mutates the attached document node by node — 18k inserts and
 * 18k removals for a dense document. If `attachMs` and `detachMs` are small next to
 * the real `viewUpdate`, then per-note views swapped by attach/detach are worth
 * building, and this is the ceiling on what that would cost.
 */
export function measureViewBuild(doc: ProseMirrorNode | null | undefined): ViewBuildMeasurement | null {
  if (!doc || !isViewBuildProbeEnabled()) return null

  const host = offscreenHost()
  let view: EditorView | null = null
  try {
    const state = EditorState.create({ doc, plugins: [] })
    const buildStartedAt = startExpensiveCall()
    view = new EditorView(host, { state })
    const coreMs = elapsedSince(buildStartedAt)

    const attachStartedAt = startExpensiveCall()
    document.body.appendChild(host)
    const attachMs = elapsedSince(attachStartedAt)

    // Kept separate: reading offsetHeight forces layout, and conflating the two
    // hides whether insertion or layout is the real cost.
    const attachLayoutStartedAt = startExpensiveCall()
    void host.offsetHeight
    const attachLayoutMs = elapsedSince(attachLayoutStartedAt)

    const detachStartedAt = startExpensiveCall()
    host.remove()
    const detachMs = elapsedSince(detachStartedAt)

    return { coreMs, attachMs, attachLayoutMs, detachMs }
  } catch {
    // A schema or node spec may refuse to render outside the real editor; the probe
    // is diagnostic only, so report "unavailable" rather than breaking the swap.
    return null
  } finally {
    view?.destroy()
    host.remove()
  }
}

export function formatViewBuild(measurement: ViewBuildMeasurement | null): string | null {
  if (!measurement) return null
  return `viewBuildCore=${measurement.coreMs.toFixed(1)}ms `
    + `viewAttach=${measurement.attachMs.toFixed(1)}ms `
    + `viewAttachLayout=${measurement.attachLayoutMs.toFixed(1)}ms `
    + `viewDetach=${measurement.detachMs.toFixed(1)}ms`
}
