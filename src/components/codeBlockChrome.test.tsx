import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlockChrome, CodeBlockFenceLine } from './codeBlockChrome'
import {
  fenceLineText,
  useActiveCodeBlockFence,
  type CodeBlockChromeEditor,
  type CodeBlockChromeTarget,
  type CodeBlockFenceTarget,
} from './codeBlockChromeState'

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
