import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '../lib/telemetry'
import { writeClipboardText } from '../utils/clipboardText'

const INLINE_CODE_SELECTOR = '.bn-inline-content code'
const INLINE_CODE_COPIED_RESET_MS = 1200
const INLINE_CODE_HINT_GAP = 6

export type InlineCodeChromeTarget = {
  code: HTMLElement
  left: number
  top: number
}

export function isInlineCodeCopyClick(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>, isMacPlatform: boolean): boolean {
  return isMacPlatform ? event.metaKey : event.ctrlKey
}

function inlineCodeChromeTarget(code: HTMLElement, container: HTMLElement, pointerX: number): InlineCodeChromeTarget {
  const rects = Array.from(code.getClientRects())
  const rect = rects.find((candidate) => pointerX >= candidate.left && pointerX <= candidate.right) ?? rects[0] ?? code.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  return {
    code,
    left: rect.left + rect.width / 2 - containerRect.left + container.scrollLeft,
    top: rect.bottom - containerRect.top + container.scrollTop + INLINE_CODE_HINT_GAP,
  }
}

function sameTarget(left: InlineCodeChromeTarget | null, right: InlineCodeChromeTarget): boolean {
  return Boolean(left && left.code === right.code && left.left === right.left && left.top === right.top)
}

function inlineCodeFromEvent(event: { target: EventTarget | null }, container: HTMLElement | null): HTMLElement | null {
  if (!(event.target instanceof HTMLElement) || !container) return null
  const code = event.target.closest<HTMLElement>(INLINE_CODE_SELECTOR)
  return code && container.contains(code) ? code : null
}

function inlineCodeAtCaret(selection: Selection | null, container: HTMLElement): HTMLElement | null {
  if (!selection || !selection.isCollapsed) return null
  const anchor = selection.anchorNode
  const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
  const code = element?.closest<HTMLElement>(INLINE_CODE_SELECTOR) ?? null
  return code && container.contains(code) ? code : null
}

/** Copy event with the caret inside inline code and nothing selected: copy the whole span. */
export function copyInlineCodeAtCaret(event: React.ClipboardEvent<HTMLElement>): boolean {
  const code = inlineCodeAtCaret(window.getSelection(), event.currentTarget)
  if (!code) return false

  event.clipboardData.setData('text/plain', code.textContent ?? '')
  event.preventDefault()
  trackEvent('inline_code_copied', { source: 'caret' })
  return true
}

export function useInlineCodeChromeTarget(containerRef: React.RefObject<HTMLDivElement | null>, isMacPlatform: boolean) {
  const [target, setTarget] = useState<InlineCodeChromeTarget | null>(null)
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const clearInlineCodeTarget = useCallback(() => {
    setTarget(null)
    setCopied(false)
  }, [])

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const code = inlineCodeFromEvent(event, container)
    if (!code || !container) {
      setTarget(null)
      return
    }

    const next = inlineCodeChromeTarget(code, container, event.clientX)
    setTarget((previous) => sameTarget(previous, next) ? previous : next)
  }, [containerRef])

  // Cmd/Ctrl-mousedown is ProseMirror's "select the clicked node" gesture, which
  // would highlight the whole block; keep it from ever reaching the editor.
  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isInlineCodeCopyClick(event, isMacPlatform)) return
    if (!inlineCodeFromEvent(event, containerRef.current)) return

    event.preventDefault()
    event.stopPropagation()
  }, [containerRef, isMacPlatform])

  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isInlineCodeCopyClick(event, isMacPlatform)) return
    const code = inlineCodeFromEvent(event, containerRef.current)
    if (!code) return

    event.preventDefault()
    event.stopPropagation()
    void writeClipboardText(code.textContent ?? '')
      .then(() => {
        trackEvent('inline_code_copied')
        setCopied(true)
        if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = window.setTimeout(() => {
          setCopied(false)
          resetTimerRef.current = null
        }, INLINE_CODE_COPIED_RESET_MS)
      })
      .catch((error) => {
        console.warn('[editor] Failed to copy inline code:', error)
      })
  }, [containerRef, isMacPlatform])

  return {
    clearInlineCodeTarget,
    handleInlineCodeClick: handleClick,
    handleInlineCodeMouseDown: handleMouseDown,
    handleInlineCodeMouseMove: handleMouseMove,
    inlineCodeCopied: copied,
    inlineCodeTarget: target,
  }
}
