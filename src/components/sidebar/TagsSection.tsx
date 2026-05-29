import { useMemo } from 'react'
import { Hash } from '@phosphor-icons/react'
import type { VaultEntry } from '../../types'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SIDEBAR_ITEM_PADDING, SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM } from './sidebarStyles'

function buildTagCounts(entries: VaultEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tag of entry.inlineTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

function isTagActive(tag: string, currentSearch: string): boolean {
  return currentSearch.toLowerCase() === `#${tag.toLowerCase()}`
}

function TagItem({
  tag,
  count,
  isActive,
  onSelect,
}: {
  tag: string
  count: number
  isActive: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`group/tag flex cursor-pointer select-none items-center justify-between rounded transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'hover:bg-accent'}`}
      style={{ padding: SIDEBAR_ITEM_PADDING.withCount, borderRadius: 4, gap: 4 }}
      onClick={onSelect}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Hash size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[13px] font-medium">{tag}</span>
      </div>
      <span
        className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground"
        style={{ borderRadius: 9999, padding: '0 6px', background: 'var(--muted)' }}
      >
        {count}
      </span>
    </div>
  )
}

export function TagsSection({
  entries,
  currentSearch,
  collapsed,
  onToggle,
  onTagSearch,
}: {
  entries: VaultEntry[]
  currentSearch: string
  collapsed: boolean
  onToggle: () => void
  onTagSearch: (tag: string) => void
}) {
  const tags = useMemo(() => buildTagCounts(entries), [entries])

  if (tags.length === 0) return null

  return (
    <div className="border-b border-border">
      <SidebarGroupHeader label="TAGS" collapsed={collapsed} onToggle={onToggle} count={tags.length} />
      {!collapsed && (
        <div style={{ paddingBottom: SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM }}>
          {tags.map(({ tag, count }) => (
            <TagItem
              key={tag}
              tag={tag}
              count={count}
              isActive={isTagActive(tag, currentSearch)}
              onSelect={() => onTagSearch(tag)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
