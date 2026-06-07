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
      $from: { parent: { isTextblock: boolean; textContent: string; type: { name: string } } }
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
  getTextCursorPosition?: () => { block: FenceBlockLike }
  updateBlock?: (
    block: FenceBlockLike,
    update: { type: string; props: Record<string, string | boolean>; content: never[] },
  ) => unknown
  setTextCursorPosition?: (block: FenceBlockLike, placement: 'start' | 'end') => void
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

function fenceProps(fence: CodeFence): Record<string, string | boolean> {
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

  trackEvent('code_block_fence_converted', { has_language: fence.language !== '', has_nowrap: fence.nowrap })
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
 * Obsidian-style code fences: pressing Enter on a paragraph that contains only
 * "```" (optionally followed by a language) converts it into a code block
 * instead of inserting a new line. Complements BlockNote's built-in input rule,
 * which only fires on "```" + space.
 */
export const createCodeFenceOnEnterExtension = createExtension(({ editor }) => {
  const fenceEditor = editor as FenceEditor
  const readView = () => fenceEditor._tiptapEditor?.view ?? fenceEditor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    const isEnter = isPlainKey(event, 'Enter')
    const isSpace = isPlainKey(event, ' ')
    if (!isEnter && !isSpace) return

    const view = readView()
    if (!view || view.isDestroyed || view.composing) return

    try {
      if (isSpace) {
        if (!insertSpaceWithoutInputRule(view)) return
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
