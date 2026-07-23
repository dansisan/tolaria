import { createExtension } from '@blocknote/core'
import { trackEvent } from '../lib/telemetry'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'

const CODE_FENCE_RE = /^```([^\s`]*)(?:[ \t]+(nowrap))?[ \t]*$/
const NOWRAP_FLAG = 'nowrap'

export interface CodeFence {
  language: string
  nowrap: boolean
}

interface ProseMirrorViewLike {
  isDestroyed?: boolean
  composing?: boolean
  dispatch?: (transaction: unknown) => void
  state: {
    tr?: { insertText: (text: string) => unknown }
    selection: {
      empty: boolean
      $from: {
        parent: { isTextblock: boolean; textContent: string; type: { name: string } }
        parentOffset: number
      }
    }
  }
}

interface FenceBlockLike {
  id: string
  type: string
}

interface FenceEditor {
  _tiptapEditor?: { view?: ProseMirrorViewLike }
  prosemirrorView?: ProseMirrorViewLike
  getTextCursorPosition?: () => { block: FenceBlockLike; nextBlock?: FenceBlockLike }
  updateBlock?: (
    block: FenceBlockLike,
    update: { type?: string; props?: Record<string, string | boolean>; content?: string | never[] },
  ) => unknown
  setTextCursorPosition?: (block: FenceBlockLike, placement: 'start' | 'end') => void
  removeBlocks?: (blocks: FenceBlockLike[]) => unknown
  insertBlocks?: (
    blocks: Array<{ type: string; props?: Record<string, string | boolean>; content?: string }>,
    referenceBlock: FenceBlockLike,
    placement: 'before' | 'after',
  ) => Array<FenceBlockLike>
}

type SupportedLanguages = Record<string, { aliases?: readonly string[] }>

let cachedSupportedLanguages: SupportedLanguages | null = null

function supportedLanguages(): SupportedLanguages {
  cachedSupportedLanguages ??= (createTolariaCodeBlockOptions().supportedLanguages ?? {}) as SupportedLanguages
  return cachedSupportedLanguages
}

/**
 * The language token and nowrap flag from a complete fence line ("```",
 * "```python", "```python nowrap", …), or null when the text is not a bare
 * code fence.
 */
export function readCodeFence(text: string): CodeFence | null {
  const match = CODE_FENCE_RE.exec(text)
  if (!match) return null

  const [, token = '', flag] = match
  if (token.toLowerCase() === NOWRAP_FLAG) return { language: '', nowrap: true }
  return { language: token, nowrap: flag !== undefined }
}

/**
 * The language token from a complete fence line ("```", "```python", …),
 * or null when the text is not a bare code fence.
 */
export function readCodeFenceLanguage(text: string): string | null {
  return readCodeFence(text)?.language ?? null
}

/** Resolve a fence language token to its canonical id (e.g. "py" → "python"). */
export function resolveFenceLanguage(token: string): string {
  const normalized = token.trim().toLowerCase()
  const languages = supportedLanguages()
  if (normalized in languages) return normalized

  const aliased = Object.entries(languages)
    .find(([, { aliases }]) => aliases?.includes(normalized))
  return aliased?.[0] ?? normalized
}

export function fenceProps(fence: CodeFence): Record<string, string | boolean> {
  return {
    ...(fence.language === '' ? {} : { language: resolveFenceLanguage(fence.language) }),
    ...(fence.nowrap ? { nowrap: true } : {}),
  }
}

function convertFenceParagraph(editor: FenceEditor, fence: CodeFence): boolean {
  const block = editor.getTextCursorPosition?.().block
  if (!block || block.type !== 'paragraph') return false

  try {
    editor.updateBlock?.(block, { type: 'codeBlock', props: fenceProps(fence), content: [] })
    editor.setTextCursorPosition?.(block, 'start')
  } catch {
    return false
  }

  trackEvent('code_block_fence_converted', { has_language: fence.language !== '' ? 1 : 0, has_nowrap: fence.nowrap ? 1 : 0 })
  return true
}

function isPlainKey(event: KeyboardEvent, key: string): boolean {
  return event.key === key
    && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.isComposing
}

/** A fence opener with a language token, e.g. "```js" — but not a bare "```". */
const LANGUAGE_FENCE_PREFIX_RE = /^```[^\s`]+/

function paragraphTextAtSelection(view: ProseMirrorViewLike): string | null {
  const { selection } = view.state
  const parent = selection.$from.parent
  if (!selection.empty || !parent.isTextblock || parent.type.name !== 'paragraph') return null
  return parent.textContent
}

/**
 * BlockNote's built-in input rule converts "```lang" into a code block on the
 * next typed space, which makes a "```lang nowrap" fence impossible to type.
 * When the paragraph already holds a language fence, insert the space through
 * a transaction (input rules only fire on direct text input) so the user can
 * finish the line; Enter then converts it. A bare "```" keeps the built-in
 * space conversion.
 */
function insertSpaceWithoutInputRule(view: ProseMirrorViewLike): boolean {
  const text = paragraphTextAtSelection(view)
  if (text === null || !LANGUAGE_FENCE_PREFIX_RE.test(text)) return false

  const transaction = view.state.tr?.insertText(' ')
  if (transaction === undefined || !view.dispatch) return false
  view.dispatch(transaction)
  return true
}

function fenceAtSelection(view: ProseMirrorViewLike): CodeFence | null {
  const text = paragraphTextAtSelection(view)
  return text === null ? null : readCodeFence(text)
}

/**
 * Deletes the empty paragraph and moves the cursor into the code block that
 * follows it. BlockNote's built-in Delete handler can't do this itself:
 * `mergeBlocksCommand`'s `canMerge` requires the previous block to already
 * have content, so an empty paragraph before a code block falls through every
 * keymap handler and reaches the browser's native forward-delete against the
 * contentEditable DOM, which corrupts the document instead of just removing
 * the blank line.
 */
function deleteEmptyParagraphBeforeCodeBlock(editor: FenceEditor, view: ProseMirrorViewLike): boolean {
  if (paragraphTextAtSelection(view) !== '') return false

  const cursor = editor.getTextCursorPosition?.()
  const nextBlock = cursor?.nextBlock
  if (!cursor?.block || !nextBlock || nextBlock.type !== 'codeBlock') return false

  try {
    editor.removeBlocks?.([cursor.block])
    editor.setTextCursorPosition?.(nextBlock, 'start')
  } catch {
    return false
  }
  return true
}

interface CodeBlockFenceSplit {
  fence: CodeFence
  beforeText: string
  afterText: string
}

/**
 * When the cursor sits right after a bare fence typed mid-code-block (e.g.
 * "```", "```python"), the text on the current line up to the cursor is the
 * fence and everything from the cursor onward — same line's remainder plus
 * every following line — is what should move into the new block. Only the
 * before-cursor text has to match the fence: the user types the fence at the
 * point they want to split, they don't retype whatever already followed it.
 */
function codeBlockFenceSplitAtCursor(view: ProseMirrorViewLike): CodeBlockFenceSplit | null {
  const { selection } = view.state
  const parent = selection.$from.parent
  if (!selection.empty || !parent.isTextblock || parent.type.name !== 'codeBlock') return null

  const text = parent.textContent
  const offset = selection.$from.parentOffset
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1

  const fence = readCodeFence(text.slice(lineStart, offset))
  if (fence === null) return null

  return {
    afterText: text.slice(offset).replace(/^\n/, ''),
    beforeText: lineStart > 0 ? text.slice(0, lineStart - 1) : '',
    fence,
  }
}

/**
 * Obsidian-style code fences: typing a bare "```" (optionally followed by a
 * language) in the middle of a code block and pressing Enter closes the code
 * block above the fence and moves everything after it into a new code block,
 * using the fence's language/nowrap for the new block.
 */
function splitCodeBlockAtFence(editor: FenceEditor, view: ProseMirrorViewLike): boolean {
  const split = codeBlockFenceSplitAtCursor(view)
  if (split === null) return false
  const { fence } = split

  const block = editor.getTextCursorPosition?.().block
  if (!block) return false

  try {
    editor.updateBlock?.(block, { content: split.beforeText })
    const inserted = editor.insertBlocks?.(
      [{ type: 'codeBlock', props: fenceProps(fence), content: split.afterText }],
      block,
      'after',
    )
    const newBlock = inserted?.[0]
    if (newBlock) editor.setTextCursorPosition?.(newBlock, 'start')
  } catch {
    return false
  }

  trackEvent('code_block_fence_split', { has_language: fence.language !== '' ? 1 : 0, has_nowrap: fence.nowrap ? 1 : 0 })
  return true
}

/**
 * Obsidian-style code fences: pressing Enter on a paragraph that contains only
 * "```" (optionally followed by a language) converts it into a code block
 * instead of inserting a new line. Complements BlockNote's built-in input rule,
 * which only fires on "```" + space. Also handles Enter mid-code-block (fence
 * splitting, see `splitCodeBlockAtFence`) and Delete on an empty line right
 * before a code block (see `deleteEmptyParagraphBeforeCodeBlock`).
 */
export const createCodeFenceOnEnterExtension = createExtension(({ editor }) => {
  const fenceEditor = editor as FenceEditor
  const readView = () => fenceEditor._tiptapEditor?.view ?? fenceEditor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    const isEnter = isPlainKey(event, 'Enter')
    const isSpace = isPlainKey(event, ' ')
    const isDelete = isPlainKey(event, 'Delete')
    if (!isEnter && !isSpace && !isDelete) return

    const view = readView()
    if (!view || view.isDestroyed || view.composing) return

    try {
      if (isSpace) {
        if (!insertSpaceWithoutInputRule(view)) return
      } else if (isDelete) {
        if (!deleteEmptyParagraphBeforeCodeBlock(fenceEditor, view)) return
      } else if (view.state.selection.empty && view.state.selection.$from.parent.type.name === 'codeBlock') {
        if (!splitCodeBlockAtFence(fenceEditor, view)) return
      } else {
        const fence = fenceAtSelection(view)
        if (fence === null || !convertFenceParagraph(fenceEditor, fence)) return
      }
    } catch {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    key: 'codeFenceOnEnter',
    mount: ({ dom, signal }) => {
      // Capture phase so the fence line is read before ProseMirror splits it
      // into a new paragraph.
      dom.addEventListener('keydown', handleKeyDown as EventListener, { capture: true, signal })
    },
  } as const
})
