import { useMemo, useState } from 'react'
import { Users } from '@phosphor-icons/react'
import type { VaultEntry } from '../../types'
import { buildPeopleMentions } from '../../utils/peopleMentions'
import { NavItem } from '../SidebarParts'
import { PeopleDialog } from '../PeopleDialog'
import { translate, type AppLocale } from '../../lib/i18n'

export function PeopleSection({
  entries,
  onPersonSearch,
  locale = 'en',
}: {
  entries: VaultEntry[]
  onPersonSearch: (query: string) => void
  locale?: AppLocale
}) {
  const people = useMemo(() => buildPeopleMentions(entries), [entries])
  const [dialogOpen, setDialogOpen] = useState(false)

  if (people.length === 0) return null

  return (
    <div className="border-b border-border" style={{ padding: '4px 6px' }}>
      <NavItem
        icon={Users}
        label={translate(locale, 'sidebar.nav.people')}
        count={people.length}
        badgeClassName="text-muted-foreground"
        badgeStyle={{ background: 'var(--muted)' }}
        onClick={() => setDialogOpen(true)}
      />
      <PeopleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        people={people}
        onSelect={onPersonSearch}
        locale={locale}
      />
    </div>
  )
}
