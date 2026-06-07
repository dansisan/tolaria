import { describe, expect, it, vi } from 'vitest'
import {
  createCodeFenceOnEnterExtension,
  readCodeFence,
  readCodeFenceLanguage,
  resolveFenceLanguage,
} from './codeFenceOnEnterExtension'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function createView(paragraphText: string, overrides: Record<string, unknown> = {}) {
  const insertedTransaction = { inserted: paragraphText }
  return {
    isDestroyed: false,
    composing: false,
    dispatch: vi.fn(),
    state: {
      tr: { insertText: vi.fn(() => insertedTransaction) },
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
    insertedTransaction,
    ...overrides,
  }
}

function createFixture(paragraphText: string, options: {
  blockType?: string
  view?: ReturnType<typeof createView>
} = {}) {
  const listeners = new Map<string, EventListener>()
  const view = options.view ?? createView(paragraphText)
  const fireKey = (key: string, event: Partial<KeyboardEvent> = {}) => {
    const listener = listeners.get('keydown')
    if (!listener) throw new Error('Extension did not register a keydown listener')
    const keyEvent = {
      key,
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
  }
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
    view,
    fireEnter: (event: Partial<KeyboardEvent> = {}) => fireKey('Enter', event),
    fireSpace: (event: Partial<KeyboardEvent> = {}) => fireKey(' ', event),
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

describe('readCodeFence', () => {
  it('reads a language with the nowrap flag', () => {
    expect(readCodeFence('```js nowrap')).toEqual({ language: 'js', nowrap: true })
  })

  it('reads a bare nowrap flag as an empty language', () => {
    expect(readCodeFence('```nowrap')).toEqual({ language: '', nowrap: true })
  })

  it('reads fences without the flag as wrapping', () => {
    expect(readCodeFence('```python')).toEqual({ language: 'python', nowrap: false })
    expect(readCodeFence('```')).toEqual({ language: '', nowrap: false })
  })

  it('tolerates trailing whitespace after the flag', () => {
    expect(readCodeFence('```ts nowrap  ')).toEqual({ language: 'ts', nowrap: true })
  })

  it('rejects other fence metadata', () => {
    expect(readCodeFence('```js title=x')).toBeNull()
    expect(readCodeFence('```js nowrap extra')).toBeNull()
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
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_converted', { has_language: false, has_nowrap: false })
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

  it('carries the nowrap flag into the code block', () => {
    const fixture = createFixture('```ts nowrap')

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, {
      type: 'codeBlock',
      props: { language: 'typescript', nowrap: true },
      content: [],
    })
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_converted', { has_language: true, has_nowrap: true })
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

  it('inserts the space itself on a language fence so the input rule cannot convert early', () => {
    const fixture = createFixture('```js')

    const event = fixture.fireSpace()

    expect(fixture.view.state.tr.insertText).toHaveBeenCalledWith(' ')
    expect(fixture.view.dispatch).toHaveBeenCalledWith(fixture.view.insertedTransaction)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(fixture.updateBlock).not.toHaveBeenCalled()
  })

  it('leaves the space alone on a bare fence so the built-in conversion still fires', () => {
    const fixture = createFixture('```')

    const event = fixture.fireSpace()

    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('leaves the space alone in ordinary paragraphs', () => {
    const fixture = createFixture('hello ``` world')

    const event = fixture.fireSpace()

    expect(fixture.view.dispatch).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
