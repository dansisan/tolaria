import type { MutableRefObject } from 'react'
import { EditorState, type Transaction } from 'prosemirror-state'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { useCreateBlockNote } from '@blocknote/react'
import { logExpensiveCall, startExpensiveCall } from '../utils/expensiveCallLog'
import { blankParagraphBlocks } from './editorTabContent'
import { EDITOR_CONTAINER_SELECTOR } from './editorDomSelection'
import { resetTextSelectionBeforeContentSwap } from './editorTiptapSelection'
import { repairMalformedEditorBlocks } from './editorBlockRepair'

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

function applyCachedDocState(
  editor: ApplyBlocksToEditorOptions['editor'],
  blocks: EditorBlocks,
): boolean {
  const cachedDoc = builtDocsByBlocks.get(blocks as unknown as object)
  if (!cachedDoc) return false
  const view = stateSwapView(editor)
  if (!view) return false

  resetTextSelectionBeforeContentSwap(editor)
  suppressSideMenuBeforeContentSwap(editor)
  // A whole-state swap also resets plugin state, which clears undo history —
  // the same isolation the addToHistory:false transaction below approximates.
  view.updateState(EditorState.create({ doc: cachedDoc, plugins: view.state.plugins as EditorState['plugins'] }))
  return true
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

function logAppliedBlocks(options: {
  startedAt: number
  route: ApplyRoute
  targetPath: string
  blockCount: number
}): void {
  const { startedAt, route, targetPath, blockCount } = options
  logExpensiveCall({
    name: 'editor.applyBlocks',
    key: `editor.applyBlocks:${targetPath}`,
    startedAt,
    detail: `route=${route} blocks=${blockCount}`,
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
  if (applyCachedDocState(editor, blocks)) {
    commitAppliedEditorContent(options)
    logAppliedBlocks({ startedAt, route: 'cachedDoc', targetPath, blockCount: blocks.length })
    return true
  }
  let route: ApplyRoute = 'replaceBlocks'
  const safeBlocks = repairMalformedEditorBlocks(blocks)
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

  rememberBuiltDoc(editor, blocks)
  commitAppliedEditorContent(options)
  logAppliedBlocks({ startedAt, route, targetPath, blockCount: safeBlocks.length })
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
