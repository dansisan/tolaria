import { useCallback, useEffect, useRef, useState } from 'react'
import { readCodeFence, resolveFenceLanguage } from './codeFenceOnEnterExtension'

export const CODE_BLOCK_SELECTOR = '[data-content-type="codeBlock"]'

export interface CodeBlockEditorViewLike {
  state: {
    selection: {
      empty: boolean
      $from: {
        parent: { type: { name: string }; textContent: string }
        parentOffset: number
      }
    }
  }
}

export interface CodeBlockChromeEditor {
  _tiptapEditor?: { view?: CodeBlockEditorViewLike }
  prosemirrorView?: CodeBlockEditorViewLike
  focus?: () => void
  getPrevBlock?: (blockId: string) => { id: string } | undefined
  getTextCursorPosition?: () => { block: { id: string; type: string; props?: Record<string, unknown> } }
  onChange?: (callback: () => void) => (() => void) | undefined
  onSelectionChange?: (callback: () => void) => (() => void) | undefined
  setTextCursorPosition?: (blockId: string, placement: 'start' | 'end') => void
  updateBlock?: (blockId: string, update: { props: Record<string, string | boolean> }) => unknown
}

export type CodeBlockChromeTarget = {
  codeBlock: HTMLElement
  left: number
  top: number
}

export function codeBlockText(codeBlock: HTMLElement): string {
  const codeElement = codeBlock.querySelector<HTMLElement>('pre code')
  return codeElement?.textContent ?? ''
}

export function readDomNowrap(codeBlock: HTMLElement): boolean {
  return codeBlock.getAttribute('data-nowrap') === 'true'
}

export function codeBlockId(codeBlock: HTMLElement): string | null {
  return codeBlock.closest('[data-id]')?.getAttribute('data-id') ?? null
}

function codeBlockChromeTarget(codeBlock: HTMLElement, container: HTMLElement): CodeBlockChromeTarget {
  const codeBlockRect = codeBlock.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  return {
    codeBlock,
    left: codeBlockRect.right - containerRect.left + container.scrollLeft - 30,
    top: codeBlockRect.top - containerRect.top + container.scrollTop + 6,
  }
}

function sameChromeTarget(left: CodeBlockChromeTarget | null, right: CodeBlockChromeTarget): boolean {
  return Boolean(
    left
      && left.codeBlock === right.codeBlock
      && left.left === right.left
      && left.top === right.top,
  )
}

export function useCodeBlockChromeTarget(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [chromeTarget, setChromeTarget] = useState<CodeBlockChromeTarget | null>(null)

  const showChromeTarget = useCallback((codeBlock: HTMLElement) => {
    const container = containerRef.current
    if (!container || !container.contains(codeBlock)) return

    const nextTarget = codeBlockChromeTarget(codeBlock, container)
    setChromeTarget((previous) => sameChromeTarget(previous, nextTarget) ? previous : nextTarget)
  }, [containerRef])

  const updateFromEventTarget = useCallback((target: EventTarget | null) => {
    const container = containerRef.current
    if (!(target instanceof HTMLElement) || !container) return
    if (target.closest('[data-editor-code-copy]')) return

    const codeBlock = target.closest<HTMLElement>(CODE_BLOCK_SELECTOR)
    if (codeBlock && container.contains(codeBlock)) {
      showChromeTarget(codeBlock)
      return
    }

    setChromeTarget(null)
  }, [containerRef, showChromeTarget])

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    updateFromEventTarget(event.target)
  }, [updateFromEventTarget])

  const handleFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    updateFromEventTarget(event.target)
  }, [updateFromEventTarget])

  const clearChromeTarget = useCallback(() => setChromeTarget(null), [])

  return { clearChromeTarget, chromeTarget, handleFocus, handleMouseMove }
}

export interface CodeBlockFenceTarget {
  blockId: string
  language: string
  nowrap: boolean
  left: number
  top: number
}

function readCursorCodeBlock(editor: CodeBlockChromeEditor): { id: string; language: string; nowrap: boolean } | null {
  try {
    const block = editor.getTextCursorPosition?.().block
    if (!block || block.type !== 'codeBlock') return null
    return {
      id: block.id,
      language: typeof block.props?.language === 'string' ? block.props.language : '',
      nowrap: block.props?.nowrap === true,
    }
  } catch {
    return null
  }
}

function fenceTargetForBlock(
  block: { id: string; language: string; nowrap: boolean },
  container: HTMLElement,
): CodeBlockFenceTarget | null {
  const codeBlock = container.querySelector<HTMLElement>(`[data-id="${block.id}"] ${CODE_BLOCK_SELECTOR}`)
  if (!codeBlock) return null

  const codeBlockRect = codeBlock.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  return {
    blockId: block.id,
    language: block.language,
    nowrap: block.nowrap,
    left: codeBlockRect.left - containerRect.left + container.scrollLeft + 17,
    top: codeBlockRect.top - containerRect.top + container.scrollTop + 7,
  }
}

function sameFenceTarget(left: CodeBlockFenceTarget | null, right: CodeBlockFenceTarget | null): boolean {
  if (left === null || right === null) return left === right
  return left.blockId === right.blockId
    && left.language === right.language
    && left.nowrap === right.nowrap
    && left.left === right.left
    && left.top === right.top
}

function readEditorView(editor: CodeBlockChromeEditor): CodeBlockEditorViewLike | null {
  return editor._tiptapEditor?.view ?? editor.prosemirrorView ?? null
}

/** True when the collapsed text cursor sits on the first line of a code block. */
export function caretOnFirstCodeBlockLine(view: CodeBlockEditorViewLike | null): boolean {
  if (!view) return false
  const { selection } = view.state
  if (!selection.empty) return false

  const parent = selection.$from.parent
  if (parent.type.name !== 'codeBlock') return false

  const firstLineBreak = parent.textContent.indexOf('\n')
  return firstLineBreak === -1 || selection.$from.parentOffset <= firstLineBreak
}

function isPlainArrowUp(event: KeyboardEvent): boolean {
  return event.key === 'ArrowUp'
    && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.isComposing
}

/**
 * Tracks the code block holding the text cursor so the fence line can render
 * inside its top edge. The room for the line is reserved by a ProseMirror node
 * decoration (codeBlockFenceDecorationExtension) that sets
 * `data-fence-line-active` on the same block.
 */
export function useActiveCodeBlockFence(
  editor: CodeBlockChromeEditor,
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const [fenceTarget, setFenceTarget] = useState<CodeBlockFenceTarget | null>(null)
  const editingFenceRef = useRef(false)
  const fenceTargetRef = useRef<CodeBlockFenceTarget | null>(null)

  const updateFenceTarget = useCallback(() => {
    if (editingFenceRef.current) return

    const container = containerRef.current
    const block = enabled && container ? readCursorCodeBlock(editor) : null
    const nextTarget = block && container ? fenceTargetForBlock(block, container) : null
    fenceTargetRef.current = nextTarget
    setFenceTarget((previous) => sameFenceTarget(previous, nextTarget) ? previous : nextTarget)
  }, [containerRef, editor, enabled])

  useEffect(() => {
    if (!enabled) return
    const unsubscribeSelection = editor.onSelectionChange?.(updateFenceTarget)
    const unsubscribeChange = editor.onChange?.(updateFenceTarget)
    return () => {
      unsubscribeSelection?.()
      unsubscribeChange?.()
    }
  }, [editor, enabled, updateFenceTarget])

  // ArrowUp on the first code line moves focus up into the fence input.
  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPlainArrowUp(event) || !fenceTargetRef.current) return
      // The fence input handles its own arrows; the ProseMirror selection is
      // still parked on the first code line while it has focus.
      if (event.target instanceof HTMLElement && event.target.hasAttribute('data-editor-code-fence-input')) return
      if (!caretOnFirstCodeBlockLine(readEditorView(editor))) return

      const input = container.querySelector<HTMLInputElement>('[data-editor-code-fence-input]')
      if (!input) return
      event.preventDefault()
      event.stopPropagation()
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }

    container.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => container.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [containerRef, editor, enabled])

  const beginFenceEditing = useCallback(() => {
    editingFenceRef.current = true
  }, [])

  const endFenceEditing = useCallback(() => {
    editingFenceRef.current = false
    updateFenceTarget()
  }, [updateFenceTarget])

  return { beginFenceEditing, endFenceEditing, fenceTarget }
}

export function fenceLineText({ language, nowrap }: { language: string; nowrap: boolean }): string {
  const languageToken = language === 'text' ? '' : language
  return `\`\`\`${languageToken}${nowrap ? `${languageToken ? ' ' : ''}nowrap` : ''}`
}

export function fencePropsFromText(text: string): Record<string, string | boolean> | null {
  const fence = readCodeFence(text.trim())
  if (fence === null) return null
  return {
    language: fence.language === '' ? 'text' : resolveFenceLanguage(fence.language),
    nowrap: fence.nowrap,
  }
}
