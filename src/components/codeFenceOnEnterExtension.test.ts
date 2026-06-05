import { describe, expect, it, vi } from 'vitest'
import {
  createCodeFenceOnEnterExtension,
  readCodeFenceLanguage,
  resolveFenceLanguage,
} from './codeFenceOnEnterExtension'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function createView(paragraphText: string, overrides: Record<string, unknown> = {}) {
  return {
    isDestroyed: false,
    composing: false,
    state: {
      selection: {
        empty: true,
        $from: {
          parent: {
            isTextblock: true,
            textContent: paragraphText,
            type: { name: 'paragraph' },
          },
        },
      },
    },
    ...overrides,
  }
}

function createFixture(paragraphText: string, options: {
  blockType?: string
  view?: ReturnType<typeof createView>
} = {}) {
  const listeners = new Map<string, EventListener>()
  const view = options.view ?? createView(paragraphText)
  const block = { id: 'block-1', type: options.blockType ?? 'paragraph' }
  const updateBlock = vi.fn()
  const setTextCursorPosition = vi.fn()
  const editor = {
    prosemirrorView: view,
    getTextCursorPosition: vi.fn(() => ({ block })),
    updateBlock,
    setTextCursorPosition,
  }
  const extension = createCodeFenceOnEnterExtension()({ editor: editor as never })
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
  }
  const controller = new AbortController()
  extension.mount?.({ dom: dom as never, root: document, signal: controller.signal })

  return {
    block,
    setTextCursorPosition,
    updateBlock,
    fireEnter(event: Partial<KeyboardEvent> = {}) {
      const listener = listeners.get('keydown')
      if (!listener) throw new Error('Extension did not register a keydown listener')
      const keyEvent = {
        key: 'Enter',
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...event,
      }
      listener(keyEvent as unknown as KeyboardEvent)
      return keyEvent
    },
  }
}

describe('readCodeFenceLanguage', () => {
  it('reads a bare fence as an empty language', () => {
    expect(readCodeFenceLanguage('```')).toBe('')
  })

  it('reads the language token', () => {
    expect(readCodeFenceLanguage('```python')).toBe('python')
  })

  it('tolerates trailing whitespace', () => {
    expect(readCodeFenceLanguage('```js  ')).toBe('js')
  })

  it('rejects non-fence text', () => {
    expect(readCodeFenceLanguage('``` some words')).toBeNull()
    expect(readCodeFenceLanguage('hello ```')).toBeNull()
    expect(readCodeFenceLanguage('``')).toBeNull()
    expect(readCodeFenceLanguage('````')).toBeNull()
  })
})

describe('resolveFenceLanguage', () => {
  it('keeps canonical language ids', () => {
    expect(resolveFenceLanguage('python')).toBe('python')
  })

  it('resolves aliases to their canonical id', () => {
    expect(resolveFenceLanguage('js')).toBe('javascript')
    expect(resolveFenceLanguage('golang')).toBe('go')
  })

  it('passes unknown tokens through lowercased', () => {
    expect(resolveFenceLanguage('Mermaid')).toBe('mermaid')
  })
})

describe('createCodeFenceOnEnterExtension', () => {
  it('converts a bare ``` paragraph into a code block on Enter', () => {
    const fixture = createFixture('```')

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, {
      type: 'codeBlock',
      props: {},
      content: [],
    })
    expect(fixture.setTextCursorPosition).toHaveBeenCalledWith(fixture.block, 'start')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_converted', { has_language: false })
  })

  it('carries the fence language into the code block', () => {
    const fixture = createFixture('```ts')

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, {
      type: 'codeBlock',
      props: { language: 'typescript' },
      content: [],
    })
  })

  it('ignores paragraphs that are not a bare fence', () => {
    const fixture = createFixture('``` not a fence')

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores Enter with modifiers', () => {
    const fixture = createFixture('```')

    fixture.fireEnter({ shiftKey: true })
    fixture.fireEnter({ metaKey: true })

    expect(fixture.updateBlock).not.toHaveBeenCalled()
  })

  it('ignores non-collapsed selections', () => {
    const view = createView('```')
    view.state.selection.empty = false
    const fixture = createFixture('```', { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).not.toHaveBeenCalled()
  })

  it('ignores fences outside paragraphs (e.g. inside an existing code block)', () => {
    const view = createView('```')
    view.state.selection.$from.parent.type.name = 'codeBlock'
    const fixture = createFixture('```', { view })

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not convert when the BlockNote block is not a paragraph', () => {
    const fixture = createFixture('```', { blockType: 'heading' })

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
