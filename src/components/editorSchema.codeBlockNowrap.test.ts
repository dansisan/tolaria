import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { inferCodeBlockLanguages } from '../utils/codeBlockLanguage'
import {
  injectDurableEditorMarkdownBlocks,
  preProcessDurableEditorMarkdown,
  serializeDurableEditorBlocks,
} from '../utils/editorDurableMarkdown'
import { schema } from './editorSchema'

type ReplaceableBlocks = Parameters<BlockNoteEditor['replaceBlocks']>[1]

/** The static schema type does not know about the runtime-added nowrap prop. */
function nowrapCodeBlock(props: Record<string, string | boolean>): ReplaceableBlocks[number] {
  return {
    type: 'codeBlock',
    props,
    content: 'const x = 1',
  } as unknown as ReplaceableBlocks[number]
}

describe('editor schema code block nowrap prop', () => {
  it('persists the nowrap prop through the document', () => {
    const editor = BlockNoteEditor.create({ schema })
    editor.replaceBlocks(editor.document, [nowrapCodeBlock({ language: 'javascript', nowrap: true })])

    expect(editor.document[0]).toMatchObject({
      type: 'codeBlock',
      props: { language: 'javascript', nowrap: true },
    })
  })

  it('defaults nowrap to false for plain code blocks', () => {
    const editor = BlockNoteEditor.create({ schema })
    editor.replaceBlocks(editor.document, [{
      type: 'codeBlock',
      props: { language: 'javascript' },
      content: 'const x = 1',
    }])

    expect(editor.document[0]).toMatchObject({
      type: 'codeBlock',
      props: { language: 'javascript', nowrap: false },
    })
  })

  it('round-trips a nowrap fence through the editor markdown pipeline', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const preprocessed = preProcessDurableEditorMarkdown({
      markdown: '```js nowrap\nconst x = 1\n```',
    })
    const parsed = await editor.tryParseMarkdownToBlocks(preprocessed)
    const blocks = inferCodeBlockLanguages(injectDurableEditorMarkdownBlocks(parsed))

    // 'js' stays as written — matching how plain ```js fences parse today.
    expect(blocks[0]).toMatchObject({
      type: 'codeBlock',
      props: { language: 'js', nowrap: true },
    })

    expect(serializeDurableEditorBlocks(editor, blocks))
      .toBe('```js nowrap\nconst x = 1\n```')
  })

  it('keeps plain fences on the ordinary markdown path', async () => {
    const editor = BlockNoteEditor.create({ schema })
    const markdown = '```javascript\nconst x = 1\n```'
    const preprocessed = preProcessDurableEditorMarkdown({ markdown })

    expect(preprocessed).toBe(markdown)

    const parsed = await editor.tryParseMarkdownToBlocks(preprocessed)
    const blocks = inferCodeBlockLanguages(injectDurableEditorMarkdownBlocks(parsed))

    expect(blocks[0]).toMatchObject({
      type: 'codeBlock',
      props: { language: 'javascript', nowrap: false },
    })
    expect(serializeDurableEditorBlocks(editor, blocks)).toContain('```javascript\n')
  })
})
