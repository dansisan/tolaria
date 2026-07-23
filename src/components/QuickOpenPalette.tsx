import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import type { VaultEntry } from '../types'
import { NoteSearchList } from './NoteSearchList'
import { useNoteSearch } from '../hooks/useNoteSearch'
import { translate, type AppLocale } from '../lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus } from '@phosphor-icons/react'
import type { NoteSearchResult } from '../hooks/useNoteSearch'

interface QuickOpenPaletteProps {
  open: boolean
  entries: VaultEntry[]
  isLoading?: boolean
  onSelect: (entry: VaultEntry) => void
  onCreateNote?: (title: string) => unknown | Promise<unknown>
  onClose: () => void
  locale?: AppLocale
}

interface QuickOpenCreateActionProps {
  title: string
  onCreate: () => void | Promise<void>
  disabled: boolean
  locale: AppLocale
}

function quickOpenEmptyMessage(isLoading: boolean, locale: AppLocale): string {
  return isLoading ? translate(locale, 'status.vault.reloading') : translate(locale, 'noteList.empty.noMatching')
}

function QuickOpenCreateAction({ title, onCreate, disabled, locale }: QuickOpenCreateActionProps) {
  return (
    <div className="border-t border-border p-2">
      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full justify-start gap-2 px-2 text-sm"
        disabled={disabled}
        onClick={() => { void onCreate() }}
      >
        <Plus size={14} className="shrink-0" />
        <span className="truncate">{translate(locale, 'noteList.quickOpenCreate', { title })}</span>
      </Button>
    </div>
  )
}

function useQuickOpenCreateAction({
  query,
  isLoading,
  resultCount,
  onCreateNote,
  onClose,
}: {
  query: string
  isLoading: boolean
  resultCount: number
  onCreateNote?: (title: string) => unknown
  onClose: () => void
}) {
  const [isCreating, setIsCreating] = useState(false)
  const title = query.trim()
  const canCreate = Boolean(onCreateNote && title && !isLoading && resultCount === 0)
  const create = useCallback(async () => {
    if (!canCreate || isCreating) return
    setIsCreating(true)
    try {
      const result = await onCreateNote?.(title)
      if (result !== false) onClose()
    } finally {
      setIsCreating(false)
    }
  }, [canCreate, isCreating, title, onCreateNote, onClose])

  return { canCreate, create, title, isCreating }
}

function useQuickOpenKeyboard({
  open,
  results,
  selectedIndex,
  onSelect,
  onClose,
  handleKeyDown,
  createFromQuery,
}: {
  open: boolean
  results: NoteSearchResult[]
  selectedIndex: number
  onSelect: (entry: VaultEntry) => void
  onClose: () => void
  handleKeyDown: (e: KeyboardEvent) => void
  createFromQuery: () => void | Promise<void>
}) {
  // Read via a ref kept in sync via useLayoutEffect (not useEffect) rather
  // than closing over these directly: re-subscribing the window listener on
  // every dependency change (every keystroke, every arrow-key move) left a
  // window where a fast state transition — e.g. the debounced search
  // settling to zero results right as Enter is pressed — could be caught by
  // a listener holding stale `results`/`selectedIndex`/`createFromQuery`
  // before the effect had re-run, misrouting Enter to `onSelect` instead of
  // creating the note. A plain `useEffect` is a passive effect deferred past
  // a scheduler boundary, so it doesn't close that window either — the ref
  // must update inside the same synchronous commit as the render, which only
  // `useLayoutEffect` guarantees.
  const latestRef = useRef({ results, selectedIndex, onSelect, onClose, handleKeyDown, createFromQuery })
  useLayoutEffect(() => {
    latestRef.current = { results, selectedIndex, onSelect, onClose, handleKeyDown, createFromQuery }
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const current = latestRef.current
      current.handleKeyDown(e)
      if (e.key === 'Escape') {
        e.preventDefault()
        current.onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = current.results.at(current.selectedIndex)
        if (selected) {
          current.onSelect(selected.entry)
          current.onClose()
        } else {
          void current.createFromQuery()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])
}

export function QuickOpenPalette({ open, entries, isLoading = false, onSelect, onCreateNote, onClose, locale = 'en' }: QuickOpenPaletteProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { results, selectedIndex, setSelectedIndex, handleKeyDown } = useNoteSearch(entries, query)
  const createAction = useQuickOpenCreateAction({ query, isLoading, resultCount: results.length, onCreateNote, onClose })

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dialog open
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, setSelectedIndex])

  useQuickOpenKeyboard({ open, results, selectedIndex, onSelect, onClose, handleKeyDown, createFromQuery: createAction.create })

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return

    const handleRootClick = (event: MouseEvent) => {
      if (event.target === root) onClose()
    }

    root.addEventListener('click', handleRootClick)
    return () => root.removeEventListener('click', handleRootClick)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={rootRef}
      data-testid="quick-open-palette"
      className="fixed inset-0 z-[1000] flex justify-center bg-[var(--shadow-dialog)] pt-[15vh]"
    >
      <button
        type="button"
        aria-label="Close quick open"
        className="absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex w-[500px] max-w-[90vw] max-h-[400px] flex-col self-start overflow-hidden rounded-xl border border-[var(--border-dialog)] bg-popover shadow-[0_8px_32px_var(--shadow-dialog)]"
      >
        <Input
          ref={inputRef}
          className="h-auto rounded-none border-0 border-b border-border px-4 py-3 text-[15px] shadow-none focus-visible:ring-0"
          type="text"
          placeholder={translate(locale, 'noteList.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NoteSearchList
          items={results}
          selectedIndex={selectedIndex}
          getItemKey={(item) => item.entry.path}
          onItemClick={(item) => {
            onSelect(item.entry)
            onClose()
          }}
          onItemHover={(i) => setSelectedIndex(i)}
          emptyMessage={quickOpenEmptyMessage(isLoading, locale)}
          className="flex-1 overflow-y-auto"
        />
        {createAction.canCreate && (
          <QuickOpenCreateAction
            title={createAction.title}
            onCreate={createAction.create}
            disabled={createAction.isCreating}
            locale={locale}
          />
        )}
      </div>
    </div>
  )
}
