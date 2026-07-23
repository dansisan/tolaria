import { CaretLineDown, CaretLineUp, ChartBar, Checks, CircleNotch as Loader2, MagnifyingGlass, Plus, SidebarSimple, X } from '@phosphor-icons/react'
import type { VaultEntry } from '../../types'
import type { SortOption, SortDirection } from '../../utils/noteListHelpers'
import { translate, type AppLocale, type TranslationKey } from '../../lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../../hooks/appCommandDispatcher'
import { getAppCommandShortcutDisplay } from '../../hooks/appCommandCatalog'
import { trackEvent } from '../../lib/telemetry'
import { useDragRegion } from '../../hooks/useDragRegion'
import { SortDropdown } from '../SortDropdown'
import { ListPropertiesPopover, type ListPropertiesPopoverProps } from './ListPropertiesPopover'
import { GitRepositorySelect } from '../GitRepositorySelect'
import type { GitRepositoryOption } from '../../utils/gitRepositories'
import { isMac } from '../../utils/platform'

const NOTE_LIST_ACTION_BUTTON_CLASSNAME = '!h-auto !w-auto !min-w-0 !rounded-none !p-0 !text-muted-foreground hover:!bg-transparent hover:!text-foreground focus-visible:!bg-transparent data-[state=open]:!bg-transparent data-[state=open]:!text-foreground [&_svg]:!size-4'
const NOTE_LIST_EXPAND_BUTTON_CLASSNAME = '!h-6 !w-6 !min-w-0 !rounded !p-0 !text-muted-foreground hover:!bg-accent hover:!text-foreground focus-visible:!bg-accent [&_svg]:!size-4'
const COLLAPSED_SIDEBAR_MAC_CHROME_PADDING = 80
const PROPERTY_TRIGGER_TITLE_KEYS: Record<string, TranslationKey> = {
  'Customize columns': 'noteList.properties.customizeColumns',
  'Customize All Notes columns': 'noteList.properties.customizeAllColumns',
  'Customize Inbox columns': 'noteList.properties.customizeInboxColumns',
}

const localizePropertiesTriggerTitle = (triggerTitle: string, locale: AppLocale): string => {
  const titleKey = PROPERTY_TRIGGER_TITLE_KEYS[triggerTitle]
  if (titleKey) return translate(locale, titleKey)
  return localizeViewPropertiesTriggerTitle(triggerTitle, locale)
}

const localizeViewPropertiesTriggerTitle = (triggerTitle: string, locale: AppLocale): string => {
  return triggerTitle.replace(/^Customize (.+) columns$/, (_match, name: string) => {
    return translate(locale, 'noteList.properties.customizeViewColumns', { name })
  })
}

interface NoteListHeaderProps {
  title: string
  typeDocument: VaultEntry | null
  isEntityView: boolean
  isChangesView?: boolean
  listSort: SortOption
  listDirection: SortDirection
  customProperties: string[]
  sidebarCollapsed?: boolean
  searchVisible: boolean
  search: string
  isSearching: boolean
  /** Matched note count for the active query, or null when not searching. */
  searchResultCount?: number | null
  searchInputRef: React.RefObject<HTMLInputElement | null>
  propertyPicker?: ListPropertiesPopoverProps | null
  /** Whether bulk-select mode is active (drives the Select button's pressed state). */
  bulkMode?: boolean
  onToggleBulkMode?: () => void
  gitRepositories?: GitRepositoryOption[]
  selectedGitRepositoryPath?: string
  locale?: AppLocale
  onSortChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
  onCreateNote: () => void
  onOpenType: (entry: VaultEntry) => void
  onToggleSearch: () => void
  onOpenTimeline: () => void
  /** Whether the list is currently sorted by a date field (created/modified), enabling the year-jump buttons. */
  canJumpByYear?: boolean
  onJumpByYear?: (direction: 'up' | 'down') => void
  onSearchChange: (value: string) => void
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onGitRepositoryChange?: (path: string) => void
}

function dispatchExpandSidebarFromHeader() {
  trackEvent('sidebar_expanded_from_note_list_header')
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, {
    detail: APP_COMMAND_IDS.viewAll,
  }))
}

function ExpandSidebarButton({ locale }: { locale: AppLocale }) {
  const expandSidebarLabel = translate(locale, 'sidebar.action.expand')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={NOTE_LIST_EXPAND_BUTTON_CLASSNAME}
      onClick={dispatchExpandSidebarFromHeader}
      title={expandSidebarLabel}
      aria-label={expandSidebarLabel}
      data-no-drag
    >
      <SidebarSimple size={16} weight="regular" />
    </Button>
  )
}

function HeaderTitle({
  title,
  typeDocument,
  onOpenType,
}: Pick<NoteListHeaderProps, 'title' | 'typeDocument' | 'onOpenType'>) {
  const handleClick = typeDocument ? () => onOpenType(typeDocument) : undefined

  if (typeDocument && handleClick) {
    return (
      <button
        type="button"
        className="m-0 min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-[14px] font-semibold"
        onClick={handleClick}
        data-testid="type-header-link"
      >
        {title}
      </button>
    )
  }

  return (
    <h3
      className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold"
    >
      {title}
    </h3>
  )
}

function HeaderLeading({
  title,
  typeDocument,
  sidebarCollapsed,
  locale,
  onOpenType,
}: Pick<NoteListHeaderProps, 'title' | 'typeDocument' | 'sidebarCollapsed' | 'locale' | 'onOpenType'> & {
  locale: AppLocale
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {sidebarCollapsed && <ExpandSidebarButton locale={locale} />}
      <HeaderTitle title={title} typeDocument={typeDocument} onOpenType={onOpenType} />
    </div>
  )
}

function RepositorySelectorRow({
  isChangesView,
  gitRepositories = [],
  selectedGitRepositoryPath = '',
  locale = 'en',
  onGitRepositoryChange,
}: Pick<
  NoteListHeaderProps,
  | 'isChangesView'
  | 'gitRepositories'
  | 'selectedGitRepositoryPath'
  | 'locale'
  | 'onGitRepositoryChange'
>) {
  if (!isChangesView || !onGitRepositoryChange || gitRepositories.length <= 1) return null

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border px-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <GitRepositorySelect
        label={translate(locale, 'git.repository.select')}
        repositories={gitRepositories}
        selectedPath={selectedGitRepositoryPath}
        onChange={onGitRepositoryChange}
        testId="changes-repository-select"
      />
    </div>
  )
}

function BulkSelectButton({
  bulkMode,
  isChangesView,
  locale,
  onToggleBulkMode,
}: Pick<NoteListHeaderProps, 'bulkMode' | 'isChangesView' | 'onToggleBulkMode'> & { locale: AppLocale }) {
  if (isChangesView || !onToggleBulkMode) return null
  const baseLabel = translate(locale, bulkMode ? 'noteList.bulkSelect.exit' : 'noteList.bulkSelect.enter')
  const shortcut = getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteBulkSelect)
  const label = shortcut ? `${baseLabel} (${shortcut})` : baseLabel
  const handleClick = () => {
    trackEvent('note_bulk_select_toggled', { state: bulkMode ? 'exit' : 'enter' })
    onToggleBulkMode()
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn(NOTE_LIST_ACTION_BUTTON_CLASSNAME, bulkMode && '!text-foreground')}
      aria-pressed={Boolean(bulkMode)}
      onClick={handleClick}
      title={label}
      aria-label={label}
      data-testid="note-list-bulk-select-toggle"
    >
      <Checks size={16} weight={bulkMode ? 'fill' : 'regular'} />
    </Button>
  )
}

/**
 * The Up/Down buttons always move physically through the list (same sense as arrow-key
 * navigation), so which one means "newer" vs "older" flips with sort direction: sorted
 * descending (newest first), Down goes further back in time; sorted ascending, Down goes
 * forward.
 */
function jumpYearLabelKey(direction: 'up' | 'down', listDirection: SortDirection): TranslationKey {
  const isNewer = (direction === 'up') === (listDirection === 'desc')
  return isNewer ? 'noteList.jumpYear.newer' : 'noteList.jumpYear.older'
}

/** Not registered in appCommandCatalog (it's list-local, like Cmd+Up/Down edge-jump), so the display string is built here following the same Mac-symbol / Ctrl+Shift+Word convention as `formatShortcutDisplay`. */
function jumpYearShortcutDisplay(direction: 'up' | 'down'): string {
  if (isMac()) return `⌘⇧${direction === 'up' ? '↑' : '↓'}`
  return `Ctrl+Shift+${direction === 'up' ? 'Up' : 'Down'}`
}

function jumpYearLabel(direction: 'up' | 'down', listDirection: SortDirection, locale: AppLocale): string {
  const baseLabel = translate(locale, jumpYearLabelKey(direction, listDirection))
  return `${baseLabel} (${jumpYearShortcutDisplay(direction)})`
}

function JumpByYearButtons({
  canJumpByYear,
  onJumpByYear,
  listDirection,
  locale,
}: {
  canJumpByYear?: boolean
  onJumpByYear?: (direction: 'up' | 'down') => void
  listDirection: SortDirection
  locale: AppLocale
}) {
  if (!onJumpByYear) return null

  const handleJump = (direction: 'up' | 'down') => {
    onJumpByYear(direction)
    trackEvent('note_list_year_jump', { direction, via: 'button' })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={NOTE_LIST_ACTION_BUTTON_CLASSNAME}
        disabled={!canJumpByYear}
        onClick={() => handleJump('up')}
        title={jumpYearLabel('up', listDirection, locale)}
        aria-label={jumpYearLabel('up', listDirection, locale)}
        data-testid="note-list-jump-year-up"
      >
        <CaretLineUp size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={NOTE_LIST_ACTION_BUTTON_CLASSNAME}
        disabled={!canJumpByYear}
        onClick={() => handleJump('down')}
        title={jumpYearLabel('down', listDirection, locale)}
        aria-label={jumpYearLabel('down', listDirection, locale)}
        data-testid="note-list-jump-year-down"
      >
        <CaretLineDown size={16} />
      </Button>
    </>
  )
}

function HeaderActions({
  isEntityView,
  isChangesView,
  listSort,
  listDirection,
  customProperties,
  propertyPicker,
  bulkMode,
  locale,
  onSortChange,
  onCreateNote,
  onToggleSearch,
  onToggleBulkMode,
  onOpenTimeline,
  canJumpByYear,
  onJumpByYear,
}: Pick<
  NoteListHeaderProps,
  | 'isEntityView'
  | 'isChangesView'
  | 'listSort'
  | 'listDirection'
  | 'customProperties'
  | 'propertyPicker'
  | 'bulkMode'
  | 'locale'
  | 'onSortChange'
  | 'onCreateNote'
  | 'onToggleSearch'
  | 'onToggleBulkMode'
  | 'onOpenTimeline'
  | 'canJumpByYear'
  | 'onJumpByYear'
> & {
  locale: AppLocale
}) {
  return (
    <div className="ml-3 flex shrink-0 items-center justify-end gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {!isEntityView && <SortDropdown groupLabel="__list__" current={listSort} direction={listDirection} customProperties={customProperties} locale={locale} onChange={onSortChange} />}
      <BulkSelectButton bulkMode={bulkMode} isChangesView={isChangesView} locale={locale} onToggleBulkMode={onToggleBulkMode} />
      <JumpByYearButtons canJumpByYear={canJumpByYear} onJumpByYear={onJumpByYear} listDirection={listDirection} locale={locale} />
      <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onOpenTimeline} title={translate(locale, 'noteList.timeline.action')} aria-label={translate(locale, 'noteList.timeline.action')}>
        <ChartBar size={16} />
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onToggleSearch} title={translate(locale, 'noteList.searchAction')} aria-label={translate(locale, 'noteList.searchAction')}>
        <MagnifyingGlass size={16} />
      </Button>
      {propertyPicker && (
        <ListPropertiesPopover
          {...propertyPicker}
          triggerTitle={localizePropertiesTriggerTitle(propertyPicker.triggerTitle, locale)}
          triggerClassName={NOTE_LIST_ACTION_BUTTON_CLASSNAME}
          locale={locale}
        />
      )}
      <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onCreateNote} title={translate(locale, 'noteList.createNote')} aria-label={translate(locale, 'noteList.createNote')}>
        <Plus size={16} />
      </Button>
    </div>
  )
}

function SearchResultCount({ count, locale }: { count: number | null | undefined; locale: AppLocale }) {
  if (count == null) return null
  return (
    <div className="mt-1 px-1 text-[11px] text-muted-foreground" data-testid="note-list-search-result-count">
      {translate(locale, 'noteList.searchResultCount', { count, plural: count === 1 ? '' : 's' })}
    </div>
  )
}

function SearchRow({
  searchVisible,
  search,
  isSearching,
  searchResultCount,
  searchInputRef,
  locale,
  onSearchChange,
  onSearchKeyDown,
}: Pick<
  NoteListHeaderProps,
  | 'searchVisible'
  | 'search'
  | 'isSearching'
  | 'searchResultCount'
  | 'searchInputRef'
  | 'locale'
  | 'onSearchChange'
  | 'onSearchKeyDown'
> & {
  locale: AppLocale
}) {
  if (!searchVisible) return null

  const hasSearch = search.length > 0
  const clearLabel = translate(locale, 'noteList.clearSearch')

  const handleClearSearch = () => {
    onSearchChange('')
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }

  return (
    <div className="border-b border-border px-3 py-2">
      <div className="relative flex-1" aria-live="polite">
        <Input
          ref={searchInputRef}
          placeholder={translate(locale, 'noteList.searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="h-8 pr-16 text-[13px]"
        />
        {hasSearch && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute inset-y-1 right-8 !h-6 !w-6 !min-w-0 !rounded !p-0 !text-muted-foreground hover:!bg-accent hover:!text-foreground focus-visible:!bg-accent [&_svg]:!size-3"
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleClearSearch}
            title={clearLabel}
            aria-label={clearLabel}
          >
            <X size={12} />
          </Button>
        )}
        {isSearching && (
          <span
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
            data-testid="note-list-search-loading"
          >
            <Loader2 size={12} className="animate-spin" />
          </span>
        )}
      </div>
      {hasSearch && <SearchResultCount count={searchResultCount} locale={locale} />}
    </div>
  )
}

export function NoteListHeader({
  title,
  typeDocument,
  isEntityView,
  isChangesView = false,
  listSort,
  listDirection,
  customProperties,
  sidebarCollapsed,
  searchVisible,
  search,
  isSearching,
  searchResultCount = null,
  searchInputRef,
  propertyPicker,
  bulkMode,
  onToggleBulkMode,
  gitRepositories = [],
  selectedGitRepositoryPath = '',
  locale = 'en',
  onSortChange,
  onCreateNote,
  onOpenType,
  onToggleSearch,
  onOpenTimeline,
  canJumpByYear,
  onJumpByYear,
  onSearchChange,
  onSearchKeyDown,
  onGitRepositoryChange,
}: NoteListHeaderProps) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()
  const collapsedSidebarPadding = sidebarCollapsed && isMac()
    ? COLLAPSED_SIDEBAR_MAC_CHROME_PADDING
    : undefined

  return (
    <>
      <div ref={dragRegionRef} className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4" style={{ cursor: 'default', paddingLeft: collapsedSidebarPadding }}>
        <HeaderLeading
          title={title}
          typeDocument={typeDocument}
          sidebarCollapsed={sidebarCollapsed}
          locale={locale}
          onOpenType={onOpenType}
        />
        <HeaderActions
          isEntityView={isEntityView}
          isChangesView={isChangesView}
          listSort={listSort}
          listDirection={listDirection}
          customProperties={customProperties}
          propertyPicker={propertyPicker}
          bulkMode={bulkMode}
          locale={locale}
          onSortChange={onSortChange}
          onCreateNote={onCreateNote}
          onToggleSearch={onToggleSearch}
          onToggleBulkMode={onToggleBulkMode}
          onOpenTimeline={onOpenTimeline}
          canJumpByYear={canJumpByYear}
          onJumpByYear={onJumpByYear}
        />
      </div>
      <RepositorySelectorRow
        isChangesView={isChangesView}
        gitRepositories={gitRepositories}
        selectedGitRepositoryPath={selectedGitRepositoryPath}
        locale={locale}
        onGitRepositoryChange={onGitRepositoryChange}
      />
      <SearchRow
        searchVisible={searchVisible}
        search={search}
        isSearching={isSearching}
        searchResultCount={searchResultCount}
        searchInputRef={searchInputRef}
        locale={locale}
        onSearchChange={onSearchChange}
        onSearchKeyDown={onSearchKeyDown}
      />
    </>
  )
}
