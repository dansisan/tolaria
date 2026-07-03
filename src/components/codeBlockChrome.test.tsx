import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlockChrome, CodeBlockFenceLine } from './codeBlockChrome'
import {
  caretOnFirstCodeBlockLine,
  fenceLineText,
  useActiveCodeBlockFence,
  type CodeBlockChromeEditor,
  type CodeBlockChromeTarget,
  type CodeBlockEditorViewLike,
  type CodeBlockFenceTarget,
} from './codeBlockChromeState'
import { fenceDecorationRange } from './codeBlockFenceDecorationExtension'

const { trackEventMock } = vi.hoisted(() => ({ trackEventMock: vi.fn() }))

vi.mock('../lib/telemetry', () => ({
  trackEvent: trackEventMock,
}))

function buildCodeBlockDom({ nowrap = false }: { nowrap?: boolean } = {}): { container: HTMLDivElement; codeBlock: HTMLElement } {
  const container = document.createElement('div')
  container.innerHTML = `
    <div data-id="block-1">
      <div class="bn-block-content" data-content-type="codeBlock"${nowrap ? ' data-nowrap="true"' : ''}>
        <pre><code>const x = 1</code></pre>
      </div>
    </div>`
  document.body.appendChild(container)
  const codeBlock = container.querySelector<HTMLElement>('[data-content-type="codeBlock"]')
  if (!codeBlock) throw new Error('fixture missing code block')
  return { container, codeBlock }
}

function chromeTargetFor(codeBlock: HTMLElement): CodeBlockChromeTarget {
  return { codeBlock, left: 100, top: 10 }
}

function fenceTargetFor(overrides: Partial<CodeBlockFenceTarget> = {}): CodeBlockFenceTarget {
  return { blockId: 'block-1', language: 'js', nowrap: true, left: 4, top: -24, ...overrides }
}

describe('CodeBlockChrome wrap toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('toggles the nowrap prop on the hovered block', () => {
    const { codeBlock } = buildCodeBlockDom()
    const updateBlock = vi.fn()
    const editor: CodeBlockChromeEditor = { updateBlock }

    render(
      <TooltipProvider>
        <CodeBlockChrome target={chromeTargetFor(codeBlock)} editor={editor} editable={true} locale="en" />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: "Don't wrap lines" }))

    expect(updateBlock).toHaveBeenCalledWith('block-1', { props: { nowrap: true } })
    expect(trackEventMock).toHaveBeenCalledWith('code_block_wrap_toggled', { nowrap: 1, source: 'button' })
  })

  it('offers to re-enable wrapping on a nowrap block', () => {
    const { codeBlock } = buildCodeBlockDom({ nowrap: true })
    const updateBlock = vi.fn()

    render(
      <TooltipProvider>
        <CodeBlockChrome target={chromeTargetFor(codeBlock)} editor={{ updateBlock }} editable={true} locale="en" />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))

    expect(updateBlock).toHaveBeenCalledWith('block-1', { props: { nowrap: false } })
  })

  it('toggles back and forth even after the block re-renders with a stale DOM node', () => {
    const { codeBlock } = buildCodeBlockDom()
    const updateBlock = vi.fn(() => {
      // BlockNote re-renders the block on updateBlock; the captured element
      // goes stale and keeps its old data-nowrap attribute.
      codeBlock.remove()
    })

    render(
      <TooltipProvider>
        <CodeBlockChrome target={chromeTargetFor(codeBlock)} editor={{ updateBlock }} editable={true} locale="en" />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: "Don't wrap lines" }))
    expect(updateBlock).toHaveBeenLastCalledWith('block-1', { props: { nowrap: true } })

    fireEvent.click(screen.getByRole('button', { name: 'Wrap lines' }))
    expect(updateBlock).toHaveBeenLastCalledWith('block-1', { props: { nowrap: false } })
  })

  it('hides the wrap toggle when the editor is read-only', () => {
    const { codeBlock } = buildCodeBlockDom()

    render(
      <TooltipProvider>
        <CodeBlockChrome target={chromeTargetFor(codeBlock)} editor={{}} editable={false} locale="en" />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('button', { name: "Don't wrap lines" })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy code to clipboard' })).toBeInTheDocument()
  })
})

describe('CodeBlockFenceLine', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('shows the fence text for the active block', () => {
    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{}}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Code fence line')).toHaveValue('```js nowrap')
  })

  it('commits an edited fence line to the block props on Enter', () => {
    const updateBlock = vi.fn()
    const focus = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{ updateBlock, focus }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Code fence line')
    fireEvent.change(input, { target: { value: '```python' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateBlock).toHaveBeenCalledWith('block-1', { props: { language: 'python', nowrap: false } })
    expect(trackEventMock).toHaveBeenCalledWith('code_block_wrap_toggled', { nowrap: 0, source: 'fence_line' })
    expect(focus).toHaveBeenCalled()
  })

  it('commits on blur and reports the editing end', () => {
    const updateBlock = vi.fn()
    const onEndEditing = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor({ nowrap: false, language: 'js' })}
        editor={{ updateBlock }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={onEndEditing}
      />,
    )

    const input = screen.getByLabelText('Code fence line')
    fireEvent.change(input, { target: { value: '```js nowrap' } })
    fireEvent.blur(input)

    expect(updateBlock).toHaveBeenCalledWith('block-1', { props: { language: 'javascript', nowrap: true } })
    expect(onEndEditing).toHaveBeenCalled()
  })

  it('reverts invalid fence text instead of committing', () => {
    const updateBlock = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{ updateBlock }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Code fence line')
    fireEvent.change(input, { target: { value: 'not a fence' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateBlock).not.toHaveBeenCalled()
    expect(input).toHaveValue('```js nowrap')
  })

  it('moves the cursor into the code on ArrowDown', () => {
    const updateBlock = vi.fn()
    const setTextCursorPosition = vi.fn()
    const focus = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor({ nowrap: false })}
        editor={{ updateBlock, setTextCursorPosition, focus }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Code fence line')
    fireEvent.change(input, { target: { value: '```js nowrap' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(updateBlock).toHaveBeenCalledWith('block-1', { props: { language: 'javascript', nowrap: true } })
    expect(setTextCursorPosition).toHaveBeenCalledWith('block-1', 'start')
    expect(focus).toHaveBeenCalled()
  })

  it('moves the cursor to the previous block on ArrowUp', () => {
    const setTextCursorPosition = vi.fn()
    const focus = vi.fn()
    const getPrevBlock = vi.fn(() => ({ id: 'block-0' }))

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{ setTextCursorPosition, focus, getPrevBlock }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('Code fence line'), { key: 'ArrowUp' })

    expect(getPrevBlock).toHaveBeenCalledWith('block-1')
    expect(setTextCursorPosition).toHaveBeenCalledWith('block-0', 'end')
    expect(focus).toHaveBeenCalled()
  })

  it('falls back to the code when no previous block exists on ArrowUp', () => {
    const setTextCursorPosition = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{ setTextCursorPosition, getPrevBlock: () => undefined }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    fireEvent.keyDown(screen.getByLabelText('Code fence line'), { key: 'ArrowUp' })

    expect(setTextCursorPosition).toHaveBeenCalledWith('block-1', 'start')
  })

  it('restores the fence text on Escape', () => {
    const focus = vi.fn()

    render(
      <CodeBlockFenceLine
        target={fenceTargetFor()}
        editor={{ focus }}
        locale="en"
        onBeginEditing={vi.fn()}
        onEndEditing={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Code fence line')
    fireEvent.change(input, { target: { value: '```py' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input).toHaveValue('```js nowrap')
    expect(focus).toHaveBeenCalled()
  })
})

describe('fenceLineText', () => {
  it('renders language and nowrap combinations', () => {
    expect(fenceLineText({ language: 'js', nowrap: false })).toBe('```js')
    expect(fenceLineText({ language: 'js', nowrap: true })).toBe('```js nowrap')
    expect(fenceLineText({ language: 'text', nowrap: true })).toBe('```nowrap')
    expect(fenceLineText({ language: 'text', nowrap: false })).toBe('```')
  })
})

describe('fenceDecorationRange', () => {
  function positionFor(nodeNames: string[], cursorDepth: number) {
    return {
      depth: cursorDepth,
      node: (depth: number) => ({ type: { name: nodeNames[depth] ?? 'doc' }, nodeSize: 10 }),
      before: (depth: number) => depth * 100,
    }
  }

  it('returns the node range of the enclosing code block', () => {
    expect(fenceDecorationRange(positionFor(['doc', 'blockContainer', 'codeBlock'], 2)))
      .toEqual({ from: 200, to: 210 })
  })

  it('returns null outside code blocks', () => {
    expect(fenceDecorationRange(positionFor(['doc', 'blockContainer', 'paragraph'], 2))).toBeNull()
  })
})

describe('caretOnFirstCodeBlockLine', () => {
  function viewWith({ type = 'codeBlock', text = 'line one\nline two', offset = 0, empty = true }): CodeBlockEditorViewLike {
    return {
      state: {
        selection: {
          empty,
          $from: { parent: { type: { name: type }, textContent: text }, parentOffset: offset },
        },
      },
    }
  }

  it('detects the first line of a code block', () => {
    expect(caretOnFirstCodeBlockLine(viewWith({ offset: 0 }))).toBe(true)
    expect(caretOnFirstCodeBlockLine(viewWith({ offset: 8 }))).toBe(true)
    expect(caretOnFirstCodeBlockLine(viewWith({ text: 'only line', offset: 9 }))).toBe(true)
  })

  it('rejects later lines, other blocks, and range selections', () => {
    expect(caretOnFirstCodeBlockLine(viewWith({ offset: 9 }))).toBe(false)
    expect(caretOnFirstCodeBlockLine(viewWith({ type: 'paragraph' }))).toBe(false)
    expect(caretOnFirstCodeBlockLine(viewWith({ empty: false }))).toBe(false)
    expect(caretOnFirstCodeBlockLine(null)).toBe(false)
  })
})

describe('useActiveCodeBlockFence', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('targets the code block holding the text cursor', () => {
    const { container } = buildCodeBlockDom()
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const editor: CodeBlockChromeEditor = {
      getTextCursorPosition: () => ({
        block: { id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: true } },
      }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    const { result } = renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    expect(result.current.fenceTarget).toMatchObject({ blockId: 'block-1', language: 'js', nowrap: true })
  })

  it('skips the cursor-block snapshot while the collapsed cursor is outside code blocks', () => {
    const { container } = buildCodeBlockDom()
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const getTextCursorPosition = vi.fn(() => ({
      block: { id: 'block-1', type: 'paragraph' as const, props: {} },
    }))
    const editor: CodeBlockChromeEditor = {
      prosemirrorView: {
        state: {
          selection: {
            empty: true,
            $from: { parent: { type: { name: 'paragraph' }, textContent: 'plain typing' }, parentOffset: 5 },
          },
        },
      },
      getTextCursorPosition,
      onChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    const { result } = renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    expect(result.current.fenceTarget).toBeNull()
    expect(getTextCursorPosition).not.toHaveBeenCalled()
  })

  it('still snapshots the cursor block for range selections outside code blocks', () => {
    const { container } = buildCodeBlockDom()
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const getTextCursorPosition = vi.fn(() => ({
      block: { id: 'block-1', type: 'paragraph' as const, props: {} },
    }))
    const editor: CodeBlockChromeEditor = {
      prosemirrorView: {
        state: {
          selection: {
            empty: false,
            $from: { parent: { type: { name: 'paragraph' }, textContent: 'plain typing' }, parentOffset: 5 },
          },
        },
      },
      getTextCursorPosition,
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    expect(getTextCursorPosition).toHaveBeenCalled()
  })

  it('moves focus into the fence input on ArrowUp from the first code line', () => {
    const { container } = buildCodeBlockDom()
    const input = document.createElement('input')
    input.setAttribute('data-editor-code-fence-input', '')
    input.value = '```js'
    container.appendChild(input)
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const editor: CodeBlockChromeEditor = {
      prosemirrorView: {
        state: {
          selection: {
            empty: true,
            $from: { parent: { type: { name: 'codeBlock' }, textContent: 'first\nsecond' }, parentOffset: 2 },
          },
        },
      },
      getTextCursorPosition: () => ({
        block: { id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: false } },
      }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    act(() => {
      container.dispatchEvent(event)
    })

    expect(document.activeElement).toBe(input)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores ArrowUp typed inside the fence input itself', () => {
    const { container } = buildCodeBlockDom()
    const input = document.createElement('input')
    input.setAttribute('data-editor-code-fence-input', '')
    container.appendChild(input)
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const editor: CodeBlockChromeEditor = {
      prosemirrorView: {
        state: {
          selection: {
            empty: true,
            $from: { parent: { type: { name: 'codeBlock' }, textContent: 'first\nsecond' }, parentOffset: 2 },
          },
        },
      },
      getTextCursorPosition: () => ({
        block: { id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: false } },
      }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    input.focus()
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    act(() => {
      input.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves ArrowUp alone below the first code line', () => {
    const { container } = buildCodeBlockDom()
    const input = document.createElement('input')
    input.setAttribute('data-editor-code-fence-input', '')
    container.appendChild(input)
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    const editor: CodeBlockChromeEditor = {
      prosemirrorView: {
        state: {
          selection: {
            empty: true,
            $from: { parent: { type: { name: 'codeBlock' }, textContent: 'first\nsecond' }, parentOffset: 8 },
          },
        },
      },
      getTextCursorPosition: () => ({
        block: { id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: false } },
      }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    act(() => {
      container.dispatchEvent(event)
    })

    expect(document.activeElement).not.toBe(input)
    expect(event.defaultPrevented).toBe(false)
  })

  it('clears the target when the cursor leaves code blocks', () => {
    const { container } = buildCodeBlockDom()
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    let cursorBlock: { id: string; type: string; props?: Record<string, unknown> } = {
      id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: false },
    }
    const editor: CodeBlockChromeEditor = {
      getTextCursorPosition: () => ({ block: cursorBlock }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    const { result } = renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))
    expect(result.current.fenceTarget).not.toBeNull()

    cursorBlock = { id: 'block-2', type: 'paragraph' }
    act(() => listeners.forEach((listener) => listener()))
    expect(result.current.fenceTarget).toBeNull()
  })

  it('keeps the target stable while the fence input is being edited', () => {
    const { container } = buildCodeBlockDom()
    const containerRef = { current: container as HTMLDivElement }
    const listeners: Array<() => void> = []
    let cursorBlock: { id: string; type: string; props?: Record<string, unknown> } = {
      id: 'block-1', type: 'codeBlock', props: { language: 'js', nowrap: false },
    }
    const editor: CodeBlockChromeEditor = {
      getTextCursorPosition: () => ({ block: cursorBlock }),
      onSelectionChange: (callback) => {
        listeners.push(callback)
        return () => {}
      },
    }

    const { result } = renderHook(() => useActiveCodeBlockFence(editor, containerRef, true))
    act(() => listeners.forEach((listener) => listener()))
    expect(result.current.fenceTarget).not.toBeNull()

    // Focusing the input moves the cursor out of the block; the target must survive.
    act(() => result.current.beginFenceEditing())
    cursorBlock = { id: 'block-2', type: 'paragraph' }
    act(() => listeners.forEach((listener) => listener()))
    expect(result.current.fenceTarget).not.toBeNull()

    act(() => result.current.endFenceEditing())
    expect(result.current.fenceTarget).toBeNull()
  })
})
