import type { useCreateBlockNote } from '@blocknote/react'
import {
  markBlankSeparatorBlocksForSerialization,
  restoreBlankLineSeparators,
} from './blankLineSeparators'
import { compactMarkdown } from './compact-markdown'
import { serializeDurableEditorBlocks } from './editorDurableMarkdown'
import { portableFileAttachmentUrls } from './fileAttachmentMarkdown'
import { portableImageUrls } from './vaultImages'
import { restoreWikilinksInBlocks, splitFrontmatter } from './wikilinks'

export function serializeRichEditorBodyToMarkdown(
  editor: ReturnType<typeof useCreateBlockNote>,
  vaultPath?: string,
): string {
  const restored = markBlankSeparatorBlocksForSerialization(restoreWikilinksInBlocks(editor.document))
  return restoreBlankLineSeparators(
    compactMarkdown(serializeDurableEditorBlocks(editor, restored, vaultPath)),
  )
}

const cachedBodyByDoc = new WeakMap<object, string>()

/**
 * Body serialization with a cache keyed on ProseMirror doc identity. Doc
 * nodes are immutable — every edit produces a new node — so a cache hit
 * means the body cannot have changed. Render-path comparisons (tab-swap
 * stability checks) call this repeatedly with an unchanged doc and would
 * otherwise re-serialize the whole note on every app-wide render.
 */
export function serializeRichEditorBodyToMarkdownCached(
  editor: ReturnType<typeof useCreateBlockNote>,
): string {
  const doc: object | undefined = editor.prosemirrorState?.doc
  if (!doc) return serializeRichEditorBodyToMarkdown(editor)

  const cached = cachedBodyByDoc.get(doc)
  if (cached !== undefined) return cached
  const serialized = serializeRichEditorBodyToMarkdown(editor)
  cachedBodyByDoc.set(doc, serialized)
  return serialized
}

export function serializeRichEditorDocumentToMarkdown(
  editor: ReturnType<typeof useCreateBlockNote>,
  tabContent: string,
  vaultPath?: string,
  notePath?: string,
): string {
  const rawBodyMarkdown = serializeRichEditorBodyToMarkdown(editor, vaultPath)
  const bodyMarkdown = vaultPath
    ? portableFileAttachmentUrls(
      portableImageUrls(rawBodyMarkdown, vaultPath, notePath),
      vaultPath,
    )
    : rawBodyMarkdown
  const [frontmatter] = splitFrontmatter(tabContent)
  return `${frontmatter}${bodyMarkdown}`
}
