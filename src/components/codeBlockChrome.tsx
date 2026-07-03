import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsInLineHorizontal, ArrowsOutLineHorizontal, Copy } from '@phosphor-icons/react'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { writeClipboardText } from '../utils/clipboardText'
import { requestEditNoteTitle } from '../utils/editNoteTitleEvent'
import { ActionTooltip } from './ui/action-tooltip'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  codeBlockId,
  codeBlockText,
  fenceLineText,
  fencePropsFromText,
  readDomNowrap,
  type CodeBlockChromeEditor,
  type CodeBlockChromeTarget,
  type CodeBlockFenceTarget,
} from './codeBlockChromeState'

const CODE_BLOCK_COPY_RESET_MS = 1200
const CODE_BLOCK_ACTION_BUTTON_CLASSNAME = 'border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent focus-visible:text-foreground'

function stopEditorMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function CodeBlockCopyButton({ codeBlock, label }: { codeBlock: HTMLElement; label: string }) {
  const [active, setActive] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  const handleCopy = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    void writeClipboardText(codeBlockText(codeBlock))
      .then(() => {
        trackEvent('code_block_copied')
        setActive(true)
        if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
        resetTimerRef.current = window.setTimeout(() => {
          setActive(false)
          resetTimerRef.current = null
        }, CODE_BLOCK_COPY_RESET_MS)
      })
      .catch((error) => {
        console.warn('[editor] Failed to copy code block:', error)
      })
  }, [codeBlock])

  return (
    <ActionTooltip copy={{ label }} side="left" align="center">
      <Button
        aria-label={label}
        className={CODE_BLOCK_ACTION_BUTTON_CLASSNAME}
        data-editor-code-copy-button
        onBlur={() => setActive(false)}
        onClick={handleCopy}
        onFocus={() => setActive(true)}
        onMouseDown={stopEditorMouseDown}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Copy aria-hidden="true" className="size-6" weight={active ? 'fill' : 'regular'} />
      </Button>
    </ActionTooltip>
  )
}

function CodeBlockWrapToggle({
  codeBlock,
  editor,
  labels,
}: {
  codeBlock: HTMLElement
  editor: CodeBlockChromeEditor
  labels: { wrap: string; nowrap: string }
}) {
  const [state, setState] = useState(() => ({ codeBlock, nowrap: readDomNowrap(codeBlock) }))
  // Render-time adjustment: re-read the wrap state when hovering a different block.
  if (state.codeBlock !== codeBlock) setState({ codeBlock, nowrap: readDomNowrap(codeBlock) })

  // Resolve the block id while the element is still connected: updateBlock
  // re-renders the block, which can detach `codeBlock` mid-hover. Component
  // state stays the toggle's source of truth for the same reason — the stale
  // element keeps its old data-nowrap attribute.
  const blockId = useMemo(() => codeBlockId(codeBlock), [codeBlock])

  const label = state.nowrap ? labels.wrap : labels.nowrap
  const handleToggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!blockId) return

    const nextNowrap = !state.nowrap
    editor.updateBlock?.(blockId, { props: { nowrap: nextNowrap } })
    setState({ codeBlock, nowrap: nextNowrap })
    trackEvent('code_block_wrap_toggled', { nowrap: nextNowrap ? 1 : 0, source: 'button' })
  }, [blockId, codeBlock, editor, state.nowrap])

  return (
    <ActionTooltip copy={{ label }} side="left" align="center">
      <Button
        aria-label={label}
        className={CODE_BLOCK_ACTION_BUTTON_CLASSNAME}
        data-editor-code-wrap-button
        onClick={handleToggle}
        onMouseDown={stopEditorMouseDown}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {state.nowrap
          ? <ArrowsInLineHorizontal aria-hidden="true" className="size-6" />
          : <ArrowsOutLineHorizontal aria-hidden="true" className="size-6" />}
      </Button>
    </ActionTooltip>
  )
}

export function CodeBlockChrome({
  target,
  editor,
  editable,
  locale,
}: {
  target: CodeBlockChromeTarget
  editor: CodeBlockChromeEditor
  editable: boolean
  locale: AppLocale
}) {
  const t = useMemo(() => createTranslator(locale), [locale])
  const left = editable ? target.left - 26 : target.left

  return (
    <div
      className="editor__code-block-copy"
      contentEditable={false}
      data-editor-code-copy
      style={{ left, top: target.top }}
    >
      <CodeBlockCopyButton codeBlock={target.codeBlock} label={t('editor.codeBlock.copy')} />
      {editable && (
        <CodeBlockWrapToggle
          codeBlock={target.codeBlock}
          editor={editor}
          labels={{ wrap: t('editor.codeBlock.wrapLines'), nowrap: t('editor.codeBlock.dontWrapLines') }}
        />
      )}
    </div>
  )
}

export function CodeBlockFenceLine({
  target,
  editor,
  locale,
  onBeginEditing,
  onEndEditing,
}: {
  target: CodeBlockFenceTarget
  editor: CodeBlockChromeEditor
  locale: AppLocale
  onBeginEditing: () => void
  onEndEditing: () => void
}) {
  const t = useMemo(() => createTranslator(locale), [locale])
  const syncedText = fenceLineText(target)
  const syncKey = `${target.blockId} ${syncedText}`
  const [draft, setDraft] = useState({ syncKey, text: syncedText })
  // Render-time adjustment: reset the draft when the block or its fence-relevant
  // props change; position-only target changes leave the draft alone.
  if (draft.syncKey !== syncKey) setDraft({ syncKey, text: syncedText })

  const commit = useCallback(() => {
    const props = fencePropsFromText(draft.text)
    if (props === null) {
      setDraft({ syncKey, text: syncedText })
      return
    }

    const changed = props.language !== target.language || props.nowrap !== target.nowrap
    if (changed) {
      editor.updateBlock?.(target.blockId, { props })
      if (props.nowrap !== target.nowrap) {
        trackEvent('code_block_wrap_toggled', { nowrap: props.nowrap ? 1 : 0, source: 'fence_line' })
      }
    }
  }, [draft.text, editor, syncKey, syncedText, target])

  const moveCursorIntoCode = useCallback(() => {
    editor.setTextCursorPosition?.(target.blockId, 'start')
    editor.focus?.()
  }, [editor, target.blockId])

  const moveCursorToPreviousBlock = useCallback(() => {
    const previousBlock = editor.getPrevBlock?.(target.blockId)
    if (previousBlock) {
      editor.setTextCursorPosition?.(previousBlock.id, 'end')
      editor.focus?.()
      return
    }
    // The code block is the note's first block — continue up into the title,
    // mirroring ArrowUp from the first line of an ordinary first block.
    requestEditNoteTitle()
  }, [editor, target.blockId])

  const insertParagraphAboveCode = useCallback(() => {
    const inserted = editor.insertBlocks?.([{ type: 'paragraph' }], target.blockId, 'before')
    const newBlockId = inserted?.[0]?.id
    if (!newBlockId) return false
    editor.setTextCursorPosition?.(newBlockId, 'start')
    editor.focus?.()
    return true
  }, [editor, target.blockId])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    // Keep editor-level shortcuts away from the fence draft.
    event.stopPropagation()
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault()
      commit()
      // Enter with the caret at the very start of the fence opens a new line
      // above the code block, like Enter at the start of any other block.
      const caretAtFenceStart = event.key === 'Enter'
        && event.currentTarget.selectionStart === 0
        && event.currentTarget.selectionEnd === 0
      if (caretAtFenceStart && insertParagraphAboveCode()) return
      moveCursorIntoCode()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      commit()
      moveCursorToPreviousBlock()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft({ syncKey, text: syncedText })
      editor.focus?.()
    }
  }, [commit, editor, insertParagraphAboveCode, moveCursorIntoCode, moveCursorToPreviousBlock, syncKey, syncedText])

  const handleBlur = useCallback(() => {
    commit()
    onEndEditing()
  }, [commit, onEndEditing])

  return (
    <div
      className="editor__code-block-fence"
      contentEditable={false}
      style={{ left: target.left, top: target.top }}
    >
      <Input
        aria-label={t('editor.codeBlock.fenceLine')}
        className="h-5 w-56 rounded-none border-none bg-transparent p-0 font-mono !text-xs text-muted-foreground shadow-none focus-visible:ring-0"
        data-editor-code-fence-input
        onBlur={handleBlur}
        onChange={(event) => setDraft({ syncKey, text: event.target.value })}
        onFocus={onBeginEditing}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        value={draft.text}
      />
    </div>
  )
}
