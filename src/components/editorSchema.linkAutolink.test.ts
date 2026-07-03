import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { schema } from './editorSchema'

type LinkExtensionLike = {
  name: string
  options?: {
    shouldAutoLink?: (text: string) => boolean
  }
}

/**
 * The patched @blocknote/core configures the TipTap link extension with a
 * `shouldAutoLink` that only converts explicitly typed web URLs. This keeps
 * filename mentions (notes.md, script.sh) from becoming bogus hyperlinks —
 * the reason the old full-document filename-autolink guard existed.
 */
function readShouldAutoLink(editor: BlockNoteEditor<typeof schema.blockSchema>): (text: string) => boolean {
  const extensions = editor._tiptapEditor.extensionManager.extensions as LinkExtensionLike[]
  const shouldAutoLink = extensions.find((extension) => extension.name === 'link')?.options?.shouldAutoLink
  if (!shouldAutoLink) throw new Error('link extension has no shouldAutoLink option — patch missing?')
  return shouldAutoLink
}

describe('editor link autolink policy', () => {
  const editor = BlockNoteEditor.create({ schema })
  const shouldAutoLink = readShouldAutoLink(editor)

  it.each([
    'https://example.com',
    'http://example.com/path?q=1',
    'HTTPS://EXAMPLE.COM',
    'www.example.com',
  ])('autolinks explicitly typed web URL %s', (text) => {
    expect(shouldAutoLink(text)).toBe(true)
  })

  it.each([
    'notes.md',
    'script.sh',
    'demo.mov',
    'archive.zip',
    'example.com',
    'sub.domain.io/path',
    'readme.txt',
  ])('leaves %s as plain text', (text) => {
    expect(shouldAutoLink(text)).toBe(false)
  })
})
