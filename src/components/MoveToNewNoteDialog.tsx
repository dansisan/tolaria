import { useEffect, useId, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTranslator, type AppLocale } from '../lib/i18n'

interface MoveToNewNoteDialogProps {
  open: boolean
  locale: AppLocale
  onClose: () => void
  onSubmit: (title: string) => Promise<void>
}

export function MoveToNewNoteDialog({ open, locale, onClose, onSubmit }: MoveToNewNoteDialogProps) {
  const t = createTranslator(locale)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleInputId = useId()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on dialog open
    setTitle('')
    setSubmitting(false)
    const timer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(timer)
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    await onSubmit(trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('editor.moveToNewNote.title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('editor.moveToNewNote.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={titleInputId} className="text-xs font-medium text-muted-foreground">
              {t('editor.moveToNewNote.nameLabel')}
            </label>
            <Input
              id={titleInputId}
              ref={inputRef}
              placeholder={t('editor.moveToNewNote.namePlaceholder')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('editor.moveToNewNote.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || submitting}>
              {t('editor.moveToNewNote.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
