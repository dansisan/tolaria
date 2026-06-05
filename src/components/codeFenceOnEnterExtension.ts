import { createExtension } from '@blocknote/core'
import { trackEvent } from '../lib/telemetry'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'

const CODE_FENCE_RE = /^```([^\s`]*)\s*$/

interface ProseMirrorViewLike {
  isDestroyed?: boolean
  composing?: boolean
  state: {
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
    update: { type: string; props: Record<string, string>; content: never[] },
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
 * The language token from a complete fence line ("```", "```python", …),
 * or null when the text is not a bare code fence.
 */
export function readCodeFenceLanguage(text: string): string | null {
  return CODE_FENCE_RE.exec(text)?.[1] ?? null
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

function fenceLanguageProps(language: string): Record<string, string> {
  return language === '' ? {} : { language: resolveFenceLanguage(language) }
}

function convertFenceParagraph(editor: FenceEditor, language: string): boolean {
  const block = editor.getTextCursorPosition?.().block
  if (!block || block.type !== 'paragraph') return false

  try {
    editor.updateBlock?.(block, { type: 'codeBlock', props: fenceLanguageProps(language), content: [] })
    editor.setTextCursorPosition?.(block, 'start')
  } catch {
    return false
  }

  trackEvent('code_block_fence_converted', { has_language: language !== '' })
  return true
}

function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    && !event.isComposing
}

function fenceLanguageAtSelection(view: ProseMirrorViewLike): string | null {
  const { selection } = view.state
  const parent = selection.$from.parent
  if (!selection.empty || !parent.isTextblock || parent.type.name !== 'paragraph') return null
  return readCodeFenceLanguage(parent.textContent)
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
    if (!isPlainEnter(event)) return

    const view = readView()
    if (!view || view.isDestroyed || view.composing) return

    let language: string | null = null
    try {
      language = fenceLanguageAtSelection(view)
    } catch {
      return
    }
    if (language === null) return

    if (!convertFenceParagraph(fenceEditor, language)) return
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
