import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineCodeCopyHint } from './inlineCodeChrome'
import { copyInlineCodeAtCaret, isInlineCodeCopyClick, useInlineCodeChromeTarget } from './inlineCodeChromeState'

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }))

vi.mock('../lib/telemetry', () => ({ trackEvent: trackEventMock }))

function buildInlineCode(): { container: HTMLDivElement; code: HTMLElement; block: HTMLElement } {
  const container = document.createElement('div')
  container.innerHTML = '<p class="bn-inline-content">run <code>pnpm test</code> now</p><pre><code>block</code></pre>'
  document.body.appendChild(container)
  return {
    container,
    code: container.querySelector('.bn-inline-content code') as HTMLElement,
    block: container.querySelector('pre code') as HTMLElement,
  }
}

const asReactEvent = (event: object) => event as unknown as React.MouseEvent<HTMLDivElement>

describe('inline code copy', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('uses cmd on mac and ctrl elsewhere', () => {
    expect(isInlineCodeCopyClick({ metaKey: true, ctrlKey: false }, true)).toBe(true)
    expect(isInlineCodeCopyClick({ metaKey: false, ctrlKey: true }, true)).toBe(false)
    expect(isInlineCodeCopyClick({ metaKey: false, ctrlKey: true }, false)).toBe(true)
  })

  it('copies the text on modifier-click only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container, code, block } = buildInlineCode()
    const { result } = renderHook(() => useInlineCodeChromeTarget({ current: container }, true))
    const click = (target: Element, metaKey: boolean) => act(() => {
      result.current.handleInlineCodeClick(asReactEvent({ target, metaKey, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }))
    })

    click(code, false)
    click(block, true)
    expect(writeText).not.toHaveBeenCalled()

    click(code, true)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('pnpm test'))
    await waitFor(() => expect(result.current.inlineCodeCopied).toBe(true))
    expect(trackEventMock).toHaveBeenCalledWith('inline_code_copied')
  })

  it('swallows modifier-mousedown on inline code so the editor never selects the block', () => {
    const { container, code, block } = buildInlineCode()
    const { result } = renderHook(() => useInlineCodeChromeTarget({ current: container }, true))
    const down = (target: Element, metaKey: boolean) => {
      const event = { target, metaKey, ctrlKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
      result.current.handleInlineCodeMouseDown(asReactEvent(event))
      return event
    }

    expect(down(code, true).stopPropagation).toHaveBeenCalled()
    expect(down(code, true).preventDefault).toHaveBeenCalled()
    expect(down(code, false).stopPropagation).not.toHaveBeenCalled()
    expect(down(block, true).stopPropagation).not.toHaveBeenCalled()
  })

  it('copies the whole span when the caret sits inside inline code', () => {
    const { container, code, block } = buildInlineCode()
    const setData = vi.fn()
    const copy = () => {
      const event = { currentTarget: container, clipboardData: { setData }, preventDefault: vi.fn() }
      return { event, handled: copyInlineCodeAtCaret(event as unknown as React.ClipboardEvent<HTMLElement>) }
    }
    const placeCaret = (node: Node, offset: number) => {
      const range = document.createRange()
      range.setStart(node, offset)
      range.collapse(true)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    }

    placeCaret(code.firstChild!, 3)
    const inside = copy()
    expect(inside.handled).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', 'pnpm test')
    expect(inside.event.preventDefault).toHaveBeenCalled()

    placeCaret(block.firstChild!, 2)
    expect(copy().handled).toBe(false)

    const range = document.createRange()
    range.selectNodeContents(code)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(copy().handled).toBe(false)
  })

  it('targets inline code on hover but not code blocks', () => {
    const { container, code, block } = buildInlineCode()
    const { result } = renderHook(() => useInlineCodeChromeTarget({ current: container }, true))
    const move = (target: Element) => act(() => {
      result.current.handleInlineCodeMouseMove(asReactEvent({ target, clientX: 0 }))
    })

    move(code)
    expect(result.current.inlineCodeTarget?.code).toBe(code)
    move(block)
    expect(result.current.inlineCodeTarget).toBeNull()
  })

  it('shows the platform hint, then the copied confirmation', () => {
    const { code } = buildInlineCode()
    const target = { code, left: 0, top: 0 }
    const { rerender } = render(<InlineCodeCopyHint target={target} copied={false} isMacPlatform locale="en" />)
    expect(screen.getByRole('status')).toHaveTextContent('⌘-click to copy')

    rerender(<InlineCodeCopyHint target={target} copied={false} isMacPlatform={false} locale="en" />)
    expect(screen.getByRole('status')).toHaveTextContent('Ctrl-click to copy')

    rerender(<InlineCodeCopyHint target={target} copied isMacPlatform locale="en" />)
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })
})
