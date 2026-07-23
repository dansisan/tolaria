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
          parentOffset: paragraphText.length,
        },
      },
    },
    insertedTransaction,
    ...overrides,
  }
}

function createCodeBlockView(text: string, parentOffset: number, overrides: Record<string, unknown> = {}) {
  return {
    isDestroyed: false,
    composing: false,
    dispatch: vi.fn(),
    state: {
      tr: { insertText: vi.fn() },
      selection: {
        empty: true,
        $from: {
          parent: {
            isTextblock: true,
            textContent: text,
            type: { name: 'codeBlock' },
          },
          parentOffset,
        },
      },
    },
    ...overrides,
  }
}

function createFixture(paragraphText: string, options: {
  blockType?: string
  view?: ReturnType<typeof createView>
  nextBlock?: { id: string; type: string } | undefined
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
  const removeBlocks = vi.fn()
  const insertBlocks = vi.fn(() => [{ id: 'block-2', type: 'codeBlock' }])
  const editor = {
    prosemirrorView: view,
    getTextCursorPosition: vi.fn(() => ({ block, nextBlock: options.nextBlock })),
    updateBlock,
    setTextCursorPosition,
    removeBlocks,
    insertBlocks,
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
    removeBlocks,
    insertBlocks,
    view,
    fireEnter: (event: Partial<KeyboardEvent> = {}) => fireKey('Enter', event),
    fireSpace: (event: Partial<KeyboardEvent> = {}) => fireKey(' ', event),
    fireDelete: (event: Partial<KeyboardEvent> = {}) => fireKey('Delete', event),
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
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_converted', { has_language: 0, has_nowrap: 0 })
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
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_converted', { has_language: 1, has_nowrap: 1 })
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

describe('Delete before a code block', () => {
  it('removes an empty paragraph and moves the cursor into the following code block', () => {
    const fixture = createFixture('', { nextBlock: { id: 'block-2', type: 'codeBlock' } })

    const event = fixture.fireDelete()

    expect(fixture.removeBlocks).toHaveBeenCalledWith([fixture.block])
    expect(fixture.setTextCursorPosition).toHaveBeenCalledWith({ id: 'block-2', type: 'codeBlock' }, 'start')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('does nothing when the paragraph is not empty', () => {
    const fixture = createFixture('hello', { nextBlock: { id: 'block-2', type: 'codeBlock' } })

    const event = fixture.fireDelete()

    expect(fixture.removeBlocks).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when the next block is not a code block', () => {
    const fixture = createFixture('', { nextBlock: { id: 'block-2', type: 'paragraph' } })

    const event = fixture.fireDelete()

    expect(fixture.removeBlocks).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when there is no next block', () => {
    const fixture = createFixture('', { nextBlock: undefined })

    const event = fixture.fireDelete()

    expect(fixture.removeBlocks).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when the current block is not a paragraph', () => {
    const view = createView('')
    view.state.selection.$from.parent.type.name = 'heading'
    const fixture = createFixture('', { view, nextBlock: { id: 'block-2', type: 'codeBlock' } })

    const event = fixture.fireDelete()

    expect(fixture.removeBlocks).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores Delete with modifier keys', () => {
    const fixture = createFixture('', { nextBlock: { id: 'block-2', type: 'codeBlock' } })

    fixture.fireDelete({ shiftKey: true })
    fixture.fireDelete({ metaKey: true })

    expect(fixture.removeBlocks).not.toHaveBeenCalled()
  })
})

describe('splitting a code block at an internal fence line on Enter', () => {
  it('keeps earlier lines above and moves later lines into a new code block below', () => {
    const text = 'const a = 1\n```\nconst b = 2'
    const view = createCodeBlockView(text, 'const a = 1\n```'.length)
    const fixture = createFixture(text, { view })

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: 'const a = 1' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: {}, content: 'const b = 2' }],
      fixture.block,
      'after',
    )
    expect(fixture.setTextCursorPosition).toHaveBeenCalledWith({ id: 'block-2', type: 'codeBlock' }, 'start')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_split', { has_language: 0, has_nowrap: 0 })
  })

  it('carries language and nowrap from the fence line into the new block, leaving the original untouched', () => {
    const text = 'const a = 1\n```python nowrap\nconst b = 2'
    const view = createCodeBlockView(text, 'const a = 1\n```python nowrap'.length)
    const fixture = createFixture(text, { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: 'const a = 1' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: { language: 'python', nowrap: true }, content: 'const b = 2' }],
      fixture.block,
      'after',
    )
    expect(trackEvent).toHaveBeenCalledWith('code_block_fence_split', { has_language: 1, has_nowrap: 1 })
  })

  it('leaves the original block empty when the fence is the first line', () => {
    const text = '```\nconst b = 2'
    const view = createCodeBlockView(text, 3)
    const fixture = createFixture(text, { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: '' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: {}, content: 'const b = 2' }],
      fixture.block,
      'after',
    )
  })

  it('creates an empty new block when the fence is the last line', () => {
    const text = 'const a = 1\n```'
    const view = createCodeBlockView(text, text.length)
    const fixture = createFixture(text, { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: 'const a = 1' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: {}, content: '' }],
      fixture.block,
      'after',
    )
  })

  it('splits into two empty blocks when the fence is the entire code block', () => {
    const text = '```'
    const view = createCodeBlockView(text, text.length)
    const fixture = createFixture(text, { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: '' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: {}, content: '' }],
      fixture.block,
      'after',
    )
  })

  it('does not intercept Enter when the current code-block line is not a bare fence', () => {
    const text = 'const a = 1'
    const view = createCodeBlockView(text, text.length)
    const fixture = createFixture(text, { view })

    const event = fixture.fireEnter()

    expect(fixture.updateBlock).not.toHaveBeenCalled()
    expect(fixture.insertBlocks).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('splits at the cursor even when the fence line already has trailing text after it', () => {
    // The user typed "```" right before existing content, without a newline
    // in between yet — only the text before the cursor needs to be the fence.
    const text = 'const a = 1\n```const b = 2'
    const view = createCodeBlockView(text, 'const a = 1\n```'.length)
    const fixture = createFixture(text, { view })

    fixture.fireEnter()

    expect(fixture.updateBlock).toHaveBeenCalledWith(fixture.block, { content: 'const a = 1' })
    expect(fixture.insertBlocks).toHaveBeenCalledWith(
      [{ type: 'codeBlock', props: {}, content: 'const b = 2' }],
      fixture.block,
      'after',
    )
  })
})
