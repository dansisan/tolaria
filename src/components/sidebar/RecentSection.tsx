import { useMemo } from 'react'
import type { VaultEntry } from '../../types'
import { buildTypeEntryMap, getTypeColor, getTypeLightColor } from '../../utils/typeColors'
import { NoteTitleIcon } from '../NoteTitleIcon'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SIDEBAR_ITEM_PADDING, SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM } from './sidebarStyles'
import { translate, type AppLocale } from '../../lib/i18n'
import { resolveRecentEntries } from '../../utils/recentNotes'
import { useHeldModifierMode } from '../../hooks/useModifierHeld'
import { isMac } from '../../utils/platform'
import { ShortcutHintBadge } from './ShortcutHintBadge'
import { MAX_SHORTCUT_ITEMS, formatShortcutHint } from './shortcutHints'

const DEFAULT_NOTE_ICON = 'file-text'

function RecentItem({
  entry,
  isActive,
  onSelect,
  typeEntryMap,
  shortcutHint,
}: {
  shortcutHint?: string
  entry: VaultEntry
  isActive: boolean
  onSelect: () => void
  typeEntryMap: Record<string, VaultEntry>
}) {
  const typeEntry = entry.isA ? typeEntryMap[entry.isA] : undefined
  const icon = entry.icon ?? typeEntry?.icon ?? DEFAULT_NOTE_ICON
  const typeColor = getTypeColor(entry.isA ?? null, typeEntry?.color)
  const typeLightColor = getTypeLightColor(entry.isA ?? null, typeEntry?.color)

  return (
    <button
      type="button"
      data-testid="sidebar-recent-item"
      className={`group/section flex w-full cursor-pointer select-none items-center rounded transition-colors ${isActive ? '' : 'hover:bg-accent'}`}
      style={{ padding: SIDEBAR_ITEM_PADDING.withCount, borderRadius: 4, gap: 4, ...(isActive ? { background: typeLightColor } : {}) }}
      onClick={onSelect}
    >
      <NoteTitleIcon icon={icon} size={16} color={typeColor} />
      <span
        className="min-w-0 truncate text-left text-[13px] font-medium"
        style={{ marginLeft: 4, color: isActive ? typeColor : undefined }}
      >
        {entry.title}
      </span>
      {shortcutHint && <span className="ml-auto flex"><ShortcutHintBadge label={shortcutHint} /></span>}
    </button>
  )
}

interface RecentSectionProps {
  entries: VaultEntry[]
  recentPaths: readonly string[]
  count: number
  activePath?: string | null
  onSelectNote: (entry: VaultEntry) => void
  collapsed: boolean
  locale?: AppLocale
  onToggle: () => void
}

export function RecentSection({
  entries,
  recentPaths,
  count,
  activePath,
  onSelectNote,
  collapsed,
  locale = 'en',
  onToggle,
}: RecentSectionProps) {
  const recent = useMemo(() => resolveRecentEntries(entries, recentPaths, count), [entries, recentPaths, count])
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const heldMode = useHeldModifierMode()

  if (recent.length === 0) return null

  return (
    <div style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={translate(locale, 'sidebar.group.recent')} collapsed={collapsed} onToggle={onToggle} count={recent.length} />
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM }}>
          {recent.map((entry, index) => (
            <RecentItem
              key={entry.path}
              entry={entry}
              isActive={entry.path === activePath}
              typeEntryMap={typeEntryMap}
              shortcutHint={heldMode === 'ctrl-alt' && index < MAX_SHORTCUT_ITEMS ? formatShortcutHint('ctrl-alt', index + 1, isMac()) : undefined}
              onSelect={() => onSelectNote(entry)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
