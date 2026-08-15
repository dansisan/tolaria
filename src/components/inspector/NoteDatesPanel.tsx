import { useState } from 'react'
import { CalendarBlank } from '@phosphor-icons/react'
import { translate, type AppLocale } from '../../lib/i18n'
import { InspectorPrompt } from './InspectorChrome'

/**
 * Offers to fill in the date keys a note is missing. Only for a note that already
 * has frontmatter — one with none is offered initialization, which adds the dates
 * itself.
 */
export function NoteDatesPanel({
  locale = 'en',
  missingKeys,
  onAddDates,
}: {
  locale?: AppLocale
  missingKeys: string[]
  onAddDates: () => Promise<void>
}) {
  const [state, setState] = useState<'idle' | 'adding' | 'failed'>('idle')

  if (missingKeys.length === 0) return null

  const addDates = async () => {
    setState('adding')
    try {
      await onAddDates()
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <InspectorPrompt
      testId="note-dates-panel"
      icon={<CalendarBlank size={24} className="text-muted-foreground" />}
      message={translate(locale, 'inspector.dates.missing', { keys: missingKeys.join(', ') })}
      action={translate(
        locale,
        state === 'adding' ? 'inspector.dates.adding' : 'inspector.dates.addButton',
      )}
      disabled={state === 'adding'}
      onClick={() => void addDates()}
    >
      {state === 'failed' && (
        <p className="m-0 text-center text-[13px] text-[var(--feedback-warning-text)]">
          {translate(locale, 'inspector.dates.failed')}
        </p>
      )}
    </InspectorPrompt>
  )
}
