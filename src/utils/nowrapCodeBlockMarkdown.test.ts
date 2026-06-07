import { describe, expect, it, vi } from 'vitest'
import {
  injectNowrapCodeBlocks,
  nowrapCodeBlockMarkdownCodec,
  preProcessNowrapCodeBlockMarkdown,
} from './nowrapCodeBlockMarkdown'
import { serializeDurableEditorBlocks } from './editorDurableMarkdown'

type CodeBlockLike = {
  type: string
  props: { language: string; nowrap: boolean }
  content: Array<{ type: string; text: string }>
}

function parseFence(markdown: string): CodeBlockLike {
  const preprocessed = preProcessNowrapCodeBlockMarkdown({ markdown })
  expect(preprocessed).not.toContain('```')
  const blocks = [{
    type: 'paragraph',
    content: [{ type: 'text', text: preprocessed.trimEnd(), styles: {} }],
    children: [],
  }]
  return injectNowrapCodeBlocks(blocks)[0] as CodeBlockLike
}

describe('nowrap code block markdown round-trip', () => {
  it('injects a "lang nowrap" fence as a code block with the nowrap prop', () => {
    const block = parseFence('```javascript nowrap\nconst x = 1\nconst y = 2\n```')

    expect(block.type).toBe('codeBlock')
    expect(block.props.language).toBe('javascript')
    expect(block.props.nowrap).toBe(true)
    expect(block.content).toEqual([{ type: 'text', text: 'const x = 1\nconst y = 2', styles: {} }])
  })

  it('injects a bare "nowrap" fence with an empty language', () => {
    const block = parseFence('```nowrap\nwide line\n```')

    expect(block.type).toBe('codeBlock')
    expect(block.props.language).toBe('')
    expect(block.props.nowrap).toBe(true)
  })

  it('leaves fences without nowrap alone', () => {
    const markdown = '```javascript\nconst x = 1\n```'
    expect(preProcessNowrapCodeBlockMarkdown({ markdown })).toBe(markdown)
  })

  it('leaves inline mentions of nowrap alone', () => {
    const markdown = 'Use `nowrap` on the fence line.'
    expect(preProcessNowrapCodeBlockMarkdown({ markdown })).toBe(markdown)
  })

  it('serializes a nowrap code block back to a "lang nowrap" fence', () => {
    const editor = { blocksToMarkdownLossy: vi.fn(() => '') }
    const blocks = [{
      type: 'codeBlock',
      props: { language: 'python', nowrap: true },
      content: [{ type: 'text', text: 'print("hi")', styles: {} }],
      children: [],
    }]

    expect(serializeDurableEditorBlocks(editor, blocks)).toBe('```python nowrap\nprint("hi")\n```')
  })

  it('serializes an empty/text language as a bare nowrap fence', () => {
    const editor = { blocksToMarkdownLossy: vi.fn(() => '') }
    const blocks = [{
      type: 'codeBlock',
      props: { language: 'text', nowrap: true },
      content: [{ type: 'text', text: 'wide', styles: {} }],
      children: [],
    }]

    expect(serializeDurableEditorBlocks(editor, blocks)).toBe('```nowrap\nwide\n```')
  })

  it('uses a longer fence when the code contains backticks', () => {
    const editor = { blocksToMarkdownLossy: vi.fn(() => '') }
    const blocks = [{
      type: 'codeBlock',
      props: { language: 'markdown', nowrap: true },
      content: [{ type: 'text', text: '```js\nx\n```', styles: {} }],
      children: [],
    }]

    expect(serializeDurableEditorBlocks(editor, blocks)).toBe('````markdown nowrap\n```js\nx\n```\n````')
  })

  it('does not serialize ordinary code blocks through the codec', () => {
    const block = {
      type: 'codeBlock',
      props: { language: 'python', nowrap: false },
      content: [{ type: 'text', text: 'print("hi")', styles: {} }],
      children: [],
    }
    expect(nowrapCodeBlockMarkdownCodec.isBlock(block)).toBe(false)
  })

  it('round-trips a nowrap fence through parse and serialize', () => {
    const source = '```typescript nowrap\nconst wide: string = "a very long line"\n```'
    const block = parseFence(source)
    const editor = { blocksToMarkdownLossy: vi.fn(() => '') }

    expect(serializeDurableEditorBlocks(editor, [block])).toBe(source)
  })
})
