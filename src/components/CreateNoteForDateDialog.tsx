import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { formatLocalISODatetime } from '../utils/dateDisplay'
import { translate, type AppLocale } from '../lib/i18n'

interface CreateNoteForDateDialogProps {
  open: boolean
  onClose: () => void
  /** Receives the entered title and the parsed created date. */
  onCreate: (title: string, createdDate: Date) => void
  locale?: AppLocale
}

interface CreateNoteForDateFormProps {
  onClose: () => void
  onCreate: (title: string, createdDate: Date) => void
  locale: AppLocale
}

const CREATED_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** Parse the "YYYY-MM-DD HH:MM:SS" frontmatter datetime format into a local Date, or null when invalid. */
function parseCreatedText(text: string): Date | null {
  const match = CREATED_PATTERN.exec(text.trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? '0'))
  if (Number.isNaN(date.getTime())) return null
  // Reject overflowed dates like 2026-02-31 that Date silently rolls forward.
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null
  return date
}

/** Combine a calendar day with the time-of-day already entered in the field. */
function withDatePart(time: Date, day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), time.getSeconds())
}

/** Default title mirroring the untitled-note naming rule used elsewhere for new notes. */
function defaultNoteTitle(): string {
  return `untitled-note-${Math.floor(Date.now() / 1000)}`
}

function CreateNoteForDateForm({ onClose, onCreate, locale }: CreateNoteForDateFormProps) {
  const [title, setTitle] = useState(defaultNoteTitle)
  const [createdText, setCreatedText] = useState(() => formatLocalISODatetime(new Date()))
  const titleInputId = useId()
  const createdInputId = useId()

  const parsed = parseCreatedText(createdText)
  const canSubmit = title.trim().length > 0 && parsed !== null

  const handleSelectDay = (day: Date | undefined) => {
    if (!day) return
    setCreatedText(formatLocalISODatetime(withDatePart(parsed ?? new Date(), day)))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !parsed) return
    onCreate(title.trim(), parsed)
    onClose()
  }

  return (
    // Controls stay above the calendar so the variable-height grid (and the
    // `fixedWeeks` constant height) never shift them. Tab order follows the DOM:
    // title → created field → Create → calendar.
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <label htmlFor={titleInputId} className="text-xs font-medium text-muted-foreground">
          {translate(locale, 'dialog.createNoteForDate.titleLabel')}
        </label>
        <Input
          id={titleInputId}
          autoFocus
          placeholder={translate(locale, 'dialog.createNoteForDate.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={createdInputId} className="text-xs font-medium text-muted-foreground">
          {translate(locale, 'dialog.createNoteForDate.dateLabel')}
        </label>
        <Input
          id={createdInputId}
          className="font-mono tabular-nums"
          spellCheck={false}
          aria-invalid={parsed === null}
          value={createdText}
          onChange={(e) => setCreatedText(e.target.value)}
          data-testid="create-note-for-date-input"
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={!canSubmit}>
          {translate(locale, 'common.create')}
        </Button>
      </DialogFooter>
      {/* 20px of breathing room below the calendar; a scroll container drops its
          own padding-bottom, so this lives on the content where it is respected. */}
      <div className="flex justify-center pb-5">
        <Calendar
          mode="single"
          fixedWeeks
          showOutsideDays
          selected={parsed ?? undefined}
          onSelect={handleSelectDay}
          defaultMonth={parsed ?? undefined}
        />
      </div>
    </form>
  )
}

export function CreateNoteForDateDialog({ open, onClose, onCreate, locale = 'en' }: CreateNoteForDateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{translate(locale, 'dialog.createNoteForDate.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {translate(locale, 'dialog.createNoteForDate.description')}
          </DialogDescription>
        </DialogHeader>
        <CreateNoteForDateForm onClose={onClose} onCreate={onCreate} locale={locale} />
      </DialogContent>
    </Dialog>
  )
}
