import { useMemo, useState } from 'react'
import { MagnifyingGlass, User } from '@phosphor-icons/react'
import { Virtuoso } from 'react-virtuoso'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildPeopleDialogRows, type PeopleDialogRow, type PersonMention } from '../utils/peopleMentions'
import { translate, type AppLocale } from '../lib/i18n'

type SortMode = 'count' | 'name'

/** How many people the "Top mentioned" preview section shows. */
const TOP_MENTIONED_COUNT = 10

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

function PersonRow({ person, onSelect }: { person: PersonMention; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full cursor-pointer select-none items-center justify-between rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
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

function PeopleDialogRowContent({
  row,
  locale,
  onSelect,
}: {
  row: PeopleDialogRow
  locale: AppLocale
  onSelect: (query: string) => void
}) {
  if (row.kind === 'header') return <SectionHeader text={headerText(locale, row)} />
  return <PersonRow person={row.person} onSelect={() => onSelect(row.person.query)} />
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

  const rows = useMemo(
    () => buildPeopleDialogRows(people, { query, sort, topCount: TOP_MENTIONED_COUNT }),
    [people, query, sort],
  )
  const hasPeople = rows.some((row) => row.kind === 'person')

  const handleSelect = (personQuery: string) => {
    onSelect(personQuery)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-2 border-b border-border p-3">
          <DialogTitle className="text-sm font-semibold">{translate(locale, 'people.dialog.title')}</DialogTitle>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate(locale, 'people.dialog.searchPlaceholder')}
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <SortToggle sort={sort} onChange={setSort} locale={locale} />
          </div>
        </DialogHeader>
        {hasPeople ? (
          <Virtuoso
            className="flex-1"
            data={rows}
            overscan={400}
            itemContent={(_index, row) => (
              <div className="px-2">
                <PeopleDialogRowContent row={row} locale={locale} onSelect={handleSelect} />
              </div>
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
