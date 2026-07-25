import type { MutableRefObject } from 'react'
import { EditorState, type Transaction } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { useCreateBlockNote } from '@blocknote/react'
import {
  elapsedSince,
  isExpensiveCallLoggingEnabled,
  logExpensiveCall,
  startExpensiveCall,
} from '../utils/expensiveCallLog'
import { blankParagraphBlocks } from './editorTabContent'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import { resetTextSelectionBeforeContentSwap } from './editorTiptapSelection'
import { repairMalformedEditorBlocks } from './editorBlockRepair'
import { drainEntryResolutionStats, formatEntryResolutionStats } from '../utils/entryResolutionStats'
import { attributeDecorations, formatDecorationAttribution, formatDecorationTimings } from './editorDecorationAttribution'
import { describeEditorDocShape, formatEditorDocShape } from './editorDocShape'
import { withSwapHiddenProbe } from './editorSwapLayoutProbe'
import { formatViewBuild, measureViewBuild } from './editorViewBuildProbe'

type EditorBlocks = unknown[]

interface StateSwapView {
  state: { doc: ProseMirrorNode; plugins: readonly unknown[] }
  updateState: (state: EditorState) => void
}

interface StateSwapEditor {
  _tiptapEditor?: { view?: StateSwapView }
  prosemirrorView?: StateSwapView
}

interface SideMenuExtensionApi {
  unfreezeMenu?: () => void
}

interface EditorWithExtensions {
  getExtension?: (key: string) => SideMenuExtensionApi | undefined
}

/**
 * BlockNote's side menu (the hover drag-handle/+ button) re-measures its
 * position on every transaction whose document changed, but only while its
 * `show` state is still true from a prior mouse hover — a case its own
 * update() exists for (a block shifting under an already-shown menu), not
 * for swapping in an entirely different note. Forcing `show` false first
 * (the same effect `unfreezeMenu()` has) skips that DOM-geometry work when
 * it can't possibly be showing the right thing afterward anyway.
 */
function suppressSideMenuBeforeContentSwap(editor: ApplyBlocksToEditorOptions['editor']): void {
  const sideMenu = (editor as unknown as EditorWithExtensions).getExtension?.('sideMenu')
  try {
    // unfreezeMenu() assumes the menu has shown at least once this session
    // and throws if its internal state is still uninitialized — harmless to
    // swallow, since there's nothing to hide in that case anyway.
    sideMenu?.unfreezeMenu?.()
  } catch {
    // Nothing to hide yet — see above.
  }
}

/**
 * ProseMirror documents already built for a given cached blocks array.
 * Docs are immutable, and block arrays are cache-identity-stable per
 * content version, so a hit means the exact doc can be reinstalled as a
 * fresh EditorState — no replace step, no schema revalidation, no history
 * mapping. That transaction machinery is ~40% of a large-note swap.
 */
const builtDocsByBlocks = new WeakMap<object, ProseMirrorNode>()

function stateSwapView(editor: ApplyBlocksToEditorOptions['editor']): StateSwapView | null {
  const source = editor as unknown as StateSwapEditor
  const view = source._tiptapEditor?.view ?? source.prosemirrorView
  if (!view || typeof view.updateState !== 'function' || !view.state?.doc) return null
  return view
}

interface CachedDocApply {
  applied: boolean
  installMs: number
  /** Building the EditorState — pure JS, touches no DOM. */
  stateCreateMs: number
  /** `view.updateState()` — DOM construction, plus any reflow it forces itself. */
  viewUpdateMs: number
  /** Selection reset + side-menu suppression before the swap. */
  prepareMs: number
  /** Whether the install ran under the hidden-container probe (layout skipped). */
  hidden: boolean
}

const NOT_APPLIED: CachedDocApply = {
  applied: false,
  installMs: 0,
  stateCreateMs: 0,
  viewUpdateMs: 0,
  prepareMs: 0,
  hidden: false,
}

function applyCachedDocState(
  editor: ApplyBlocksToEditorOptions['editor'],
  blocks: EditorBlocks,
): CachedDocApply {
  const cachedDoc = builtDocsByBlocks.get(blocks as unknown as object)
  if (!cachedDoc) return NOT_APPLIED
  const view = stateSwapView(editor)
  if (!view) return NOT_APPLIED

  const prepareStartedAt = startExpensiveCall()
  resetTextSelectionBeforeContentSwap(editor)
  suppressSideMenuBeforeContentSwap(editor)
  const prepareMs = elapsedSince(prepareStartedAt)

  // A whole-state swap also resets plugin state, which clears undo history —
  // the same isolation the addToHistory:false transaction below approximates.
  const stateStartedAt = startExpensiveCall()
  const nextState = EditorState.create({
    doc: cachedDoc,
    plugins: view.state.plugins as EditorState['plugins'],
  })
  const stateCreateMs = elapsedSince(stateStartedAt)

  const viewStartedAt = startExpensiveCall()
  const { hidden } = withSwapHiddenProbe(() => view.updateState(nextState))
  const viewUpdateMs = elapsedSince(viewStartedAt)

  return {
    applied: true,
    installMs: stateCreateMs + viewUpdateMs,
    stateCreateMs,
    viewUpdateMs,
    prepareMs,
    hidden,
  }
}

function rememberBuiltDoc(editor: ApplyBlocksToEditorOptions['editor'], blocks: EditorBlocks): void {
  const view = stateSwapView(editor)
  if (view) builtDocsByBlocks.set(blocks as unknown as object, view.state.doc)
}

export type EditorContentPathRef = MutableRefObject<string | null>

interface AppliedEditorContentCommit {
  editorContentPathRef: EditorContentPathRef
  scrollTop: number
  suppressChangeRef: MutableRefObject<boolean>
  targetPath: string
}

interface ApplyBlocksToEditorOptions extends AppliedEditorContentCommit {
  editor: ReturnType<typeof useCreateBlockNote>
  blocks: EditorBlocks
}

interface ApplyBlankStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
}

interface ApplyMarkupStateToEditorOptions extends Omit<AppliedEditorContentCommit, 'scrollTop'> {
  editor: ReturnType<typeof useCreateBlockNote>
  markup: string
}

/** Which commit route the swap took. `cachedDoc` reinstalls a prebuilt
 * ProseMirror doc; `replaceBlocks` pays the full transaction/revalidation cost. */
type ApplyRoute = 'cachedDoc' | 'replaceBlocks' | 'htmlFallback'

interface ApplyPhases {
  /** Block-tree repair walk. Zero on the cachedDoc route, which skips it. */
  repairMs: number
  /** Installing the document into ProseMirror: updateState, or the replace transaction. */
  installMs: number
  /** cachedDoc route only: install split into its JS and DOM halves. */
  stateCreateMs?: number
  viewUpdateMs?: number
  prepareMs?: number
  hidden?: boolean
}

/**
 * Flushes pending layout for the freshly installed document and reports what that
 * cost, splitting "ProseMirror built the document" from "the browser laid it out".
 * Those point at opposite fixes, so the split is the whole reason this exists.
 *
 * Reading `scrollHeight` forces the synchronous reflow. That work would happen at
 * the next paint anyway, but forcing it early can provoke an extra reflow if more
 * mutations follow, so it only runs when logging is switched on.
 */
function measureForcedLayout(): { layoutMs: number; height: number } | null {
  if (!isExpensiveCallLoggingEnabled()) return null

  const startedAt = startExpensiveCall()
  const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
  const height = scrollEl?.scrollHeight ?? 0
  return { layoutMs: elapsedSince(startedAt), height }
}

function formatApplyDetail(options: {
  route: ApplyRoute
  blockCount: number
  phases: ApplyPhases
  docShape?: string
}): string {
  const { route, blockCount, phases } = options
  const parts = [
    `route=${route}`,
    `blocks=${blockCount}`,
    `repair=${phases.repairMs.toFixed(1)}ms`,
    `install=${phases.installMs.toFixed(1)}ms`,
  ]

  if (phases.stateCreateMs !== undefined) parts.push(`stateCreate=${phases.stateCreateMs.toFixed(1)}ms`)
  if (phases.viewUpdateMs !== undefined) parts.push(`viewUpdate=${phases.viewUpdateMs.toFixed(1)}ms`)
  if (phases.prepareMs !== undefined) parts.push(`prepare=${phases.prepareMs.toFixed(1)}ms`)
  if (phases.hidden) parts.push('hidden=true')

  const layout = measureForcedLayout()
  if (layout) {
    parts.push(`layout=${layout.layoutMs.toFixed(1)}ms`, `height=${layout.height}`)
  }
  if (options.docShape) parts.push(options.docShape)
  return parts.join(' ')
}

/** What the install had to build. Walks the document, so diagnostics-gated. */
function describeInstalledDoc(editor: ApplyBlocksToEditorOptions['editor']): string | undefined {
  if (!isExpensiveCallLoggingEnabled()) return undefined
  const state = stateSwapView(editor)?.state as EditorState | undefined
  const parts = [formatEditorDocShape(describeEditorDocShape(state?.doc))]
  // Drained here so the counts belong to this install and do not leak into the next.
  parts.push(formatEntryResolutionStats(drainEntryResolutionStats()))
  const viewBuild = formatViewBuild(measureViewBuild(state?.doc))
  if (viewBuild) parts.push(viewBuild)

  const decorations = attributeDecorations(state)
  const decorationSummary = formatDecorationAttribution(decorations)
  if (decorationSummary) parts.push(decorationSummary)
  const decorationTimings = formatDecorationTimings(decorations)
  if (decorationTimings) parts.push(decorationTimings)
  return parts.join(' ')
}

function logAppliedBlocks(options: {
  startedAt: number
  route: ApplyRoute
  targetPath: string
  blockCount: number
  phases: ApplyPhases
  editor: ApplyBlocksToEditorOptions['editor']
}): void {
  const { startedAt, route, targetPath, blockCount, phases, editor } = options
  logExpensiveCall({
    name: 'editor.applyBlocks',
    key: `editor.applyBlocks:${targetPath}`,
    startedAt,
    detail: formatApplyDetail({ route, blockCount, phases, docShape: describeInstalledDoc(editor) }),
  })
}

/**
 * Time from the swap starting to the next animation frame — the closest proxy for
 * what the user actually waits for, since it covers layout and paint rather than
 * just the JS. Costs an extra frame callback, so it is logging-gated.
 */
function logAppliedBlocksFrame(options: { startedAt: number; route: ApplyRoute; targetPath: string }): void {
  const { startedAt, route, targetPath } = options
  if (!isExpensiveCallLoggingEnabled()) return

  requestNextFrame(() => {
    logExpensiveCall({
      name: 'editor.applyBlocksFrame',
      key: `editor.applyBlocksFrame:${targetPath}`,
      startedAt,
      detail: `route=${route}`,
    })
  })
}

export function applyBlocksToEditor(options: ApplyBlocksToEditorOptions): boolean {
  const {
    editor,
    blocks,
    suppressChangeRef,
    targetPath,
  } = options
  const startedAt = startExpensiveCall()
  suppressChangeRef.current = true
  const cachedDocApply = applyCachedDocState(editor, blocks)
  if (cachedDocApply.applied) {
    commitAppliedEditorContent(options)
    logAppliedBlocks({
      startedAt,
      route: 'cachedDoc',
      targetPath,
      editor,
      blockCount: blocks.length,
      phases: {
        repairMs: 0,
        installMs: cachedDocApply.installMs,
        stateCreateMs: cachedDocApply.stateCreateMs,
        viewUpdateMs: cachedDocApply.viewUpdateMs,
        prepareMs: cachedDocApply.prepareMs,
        hidden: cachedDocApply.hidden,
      },
    })
    logAppliedBlocksFrame({ startedAt, route: 'cachedDoc', targetPath })
    return true
  }
  let route: ApplyRoute = 'replaceBlocks'
  const repairStartedAt = startExpensiveCall()
  const safeBlocks = repairMalformedEditorBlocks(blocks)
  const repairMs = elapsedSince(repairStartedAt)
  const installStartedAt = startExpensiveCall()
  try {
    resetTextSelectionBeforeContentSwap(editor)
    suppressSideMenuBeforeContentSwap(editor)
    // Load the note's content without recording it in the undo history. The
    // BlockNote editor instance is reused across notes, so a recordable swap
    // would let Cmd+Z undo the content load itself — emptying the note (or
    // reverting to a previously open note's content). Marking the transaction
    // `addToHistory: false` keeps undo scoped to the user's edits since open.
    editor.transact((tr: Transaction) => {
      tr.setMeta('addToHistory', false)
      const current = editor.document
      if (current.length > 0 && safeBlocks.length > 0) {
        editor.replaceBlocks(current, safeBlocks)
      } else if (safeBlocks.length > 0) {
        editor.insertBlocks(safeBlocks, current[0], 'before')
      }
    })
  } catch (err) {
    console.error('applyBlocks failed, trying fallback:', err)
    route = 'htmlFallback'
    try {
      const markup = editor.blocksToHTMLLossy(safeBlocks)
      editor._tiptapEditor.commands.setContent(markup)
    } catch (err2) {
      console.error('Fallback also failed:', err2)
      suppressChangeRef.current = false
      return false
    }
  }

  const installMs = elapsedSince(installStartedAt)
  rememberBuiltDoc(editor, blocks)
  commitAppliedEditorContent(options)
  logAppliedBlocks({
    startedAt,
    route,
    targetPath,
    editor,
    blockCount: safeBlocks.length,
    phases: { repairMs, installMs },
  })
  logAppliedBlocksFrame({ startedAt, route, targetPath })
  return true
}

export function applyBlankStateToEditor(options: ApplyBlankStateToEditorOptions): boolean {
  return applyBlocksToEditor({ ...options, blocks: blankParagraphBlocks(), scrollTop: 0 })
}

export function applyHtmlStateToEditor(options: ApplyMarkupStateToEditorOptions) {
  const {
    editor,
    markup,
    suppressChangeRef,
  } = options
  suppressChangeRef.current = true
  try {
    resetTextSelectionBeforeContentSwap(editor)
    editor._tiptapEditor.commands.setContent(markup)
  } catch (err) {
    console.error('applyHtmlStateToEditor failed:', err)
    suppressChangeRef.current = false
    throw err
  }

  commitAppliedEditorContent({ ...options, scrollTop: 0 })
}

function commitAppliedEditorContent(options: AppliedEditorContentCommit) {
  const {
    editorContentPathRef,
    scrollTop,
    suppressChangeRef,
    targetPath,
  } = options

  requestNextFrame(() => {
    editorContentPathRef.current = targetPath
    suppressChangeRef.current = false
    const scrollEl = document.querySelector(EDITOR_CONTAINER_SELECTOR)
    if (scrollEl) scrollEl.scrollTop = scrollTop
  })
}

function requestNextFrame(callback: FrameRequestCallback): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(callback)
    return
  }

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback)
    return
  }

  setTimeout(() => callback(Date.now()), 0)
}
