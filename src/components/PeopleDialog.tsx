import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass, User } from '@phosphor-icons/react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  buildPeopleDialogRows,
  firstPersonRowIndex,
  movePersonSelection,
  type PeopleDialogRow,
  type PersonMention,
} from '../utils/peopleMentions'
import { translate, type AppLocale } from '../lib/i18n'

type SortMode = 'count' | 'name'

/** How many people the "Top mentioned" preview section shows. */
const TOP_MENTIONED_COUNT = 10

interface PeopleDialogRowContext {
  selectedIndex: number | null
  locale: AppLocale
  onSelect: (query: string) => void
}

function headerText(locale: AppLocale, row: Extract<PeopleDialogRow, { kind: 'header' }>): string {
  if (row.label === 'top') return translate(locale, 'people.dialog.topMentioned')
  if (row.label === 'all') return translate(locale, 'people.dialog.allPeople', { count: row.count })
  return translate(locale, 'people.dialog.results', { count: row.count })
}

function SectionHeader({ text }: { text: string }) {
  return (
    <div
      className="bg-background px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      style={{ letterSpacing: 0.5 }}
    >
      {text}
    </div>
  )
}

function PersonRow({ person, isSelected, onSelect }: { person: PersonMention; isSelected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      data-selected={isSelected || undefined}
      className={`flex w-full cursor-pointer select-none items-center justify-between rounded px-2 py-1.5 text-left transition-colors ${isSelected ? 'bg-accent' : 'hover:bg-accent'}`}
      style={{ gap: 8 }}
      onClick={onSelect}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <User size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[13px] font-medium">{person.name}</span>
      </span>
      <span
        className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground"
        style={{ borderRadius: 9999, padding: '0 6px', background: 'var(--muted)' }}
      >
        {person.count}
      </span>
    </button>
  )
}

function SortToggle({ sort, onChange, locale }: { sort: SortMode; onChange: (sort: SortMode) => void; locale: AppLocale }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" size="xs" variant={sort === 'count' ? 'secondary' : 'ghost'} onClick={() => onChange('count')}>
        {translate(locale, 'people.dialog.sortByCount')}
      </Button>
      <Button type="button" size="xs" variant={sort === 'name' ? 'secondary' : 'ghost'} onClick={() => onChange('name')}>
        {translate(locale, 'people.dialog.sortByName')}
      </Button>
    </div>
  )
}

function renderPeopleDialogRow(index: number, row: PeopleDialogRow, context: PeopleDialogRowContext) {
  if (row.kind === 'header') return <SectionHeader text={headerText(context.locale, row)} />
  return (
    <PersonRow
      person={row.person}
      isSelected={context.selectedIndex === index}
      onSelect={() => context.onSelect(row.person.query)}
    />
  )
}

export function PeopleDialog({
  open,
  onOpenChange,
  people,
  onSelect,
  locale = 'en',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  people: PersonMention[]
  onSelect: (query: string) => void
  locale?: AppLocale
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('count')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(
    () => buildPeopleDialogRows(people, { query, sort, topCount: TOP_MENTIONED_COUNT }),
    [people, query, sort],
  )
  const hasPeople = rows.some((row) => row.kind === 'person')

  useEffect(() => {
    if (selectedIndex !== null) virtuosoRef.current?.scrollToIndex({ index: selectedIndex, align: 'center' })
  }, [selectedIndex])

  // Filtering or re-sorting invalidates the highlighted index, so drop back to the search box.
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    setSelectedIndex(null)
  }, [])
  const handleSortChange = useCallback((next: SortMode) => {
    setSort(next)
    setSelectedIndex(null)
  }, [])

  const handleSelect = useCallback((personQuery: string) => {
    onSelect(personQuery)
    onOpenChange(false)
  }, [onSelect, onOpenChange])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => movePersonSelection(rows, current, 'down'))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => movePersonSelection(rows, current, 'up'))
    } else if (event.key === 'Enter') {
      const targetIndex = selectedIndex ?? firstPersonRowIndex(rows)
      const target = targetIndex !== null ? rows[targetIndex] : null
      if (target?.kind === 'person') {
        event.preventDefault()
        handleSelect(target.person.query)
      }
    }
  }, [rows, selectedIndex, handleSelect])

  const context = useMemo<PeopleDialogRowContext>(
    () => ({ selectedIndex, locale, onSelect: handleSelect }),
    [selectedIndex, locale, handleSelect],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-2 border-b border-border p-3">
          <DialogTitle className="text-sm font-semibold">{translate(locale, 'people.dialog.title')}</DialogTitle>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={translate(locale, 'people.dialog.searchPlaceholder')}
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <SortToggle sort={sort} onChange={handleSortChange} locale={locale} />
          </div>
        </DialogHeader>
        {hasPeople ? (
          <Virtuoso
            ref={virtuosoRef}
            className="flex-1"
            data={rows}
            context={context}
            overscan={400}
            itemContent={(index, row, ctx) => (
              <div className="px-2">{renderPeopleDialogRow(index, row, ctx)}</div>
            )}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
            {translate(locale, 'people.dialog.empty')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
