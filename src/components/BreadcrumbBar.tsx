import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { NoteWidthMode, VaultEntry } from '../types'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import { APP_COMMAND_IDS, formatShortcutDisplay, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import { extractFrontmatterTitleFromContent, extractH1TitleFromContent, isDefaultNoteType } from '../utils/noteTitle'
import { EDIT_NOTE_TITLE_EVENT } from '../utils/editNoteTitleEvent'
import { sanitizeFilenameStem } from '../utils/filenameStem'
import { requestToast } from '../utils/toastEvent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionTooltip, type ActionTooltipCopy } from '@/components/ui/action-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceInitialsBadge } from './WorkspaceInitialsBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  GitBranch,
  Code,
  ListBullets,
  SidebarSimple,
  Trash,
  Archive,
  ArrowUUpLeft,
  ClipboardText,
  FilePdf,
  FolderOpen,
  Link,
  MapTrifold,
  Star,
  CheckCircle,
  ArrowsClockwise,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  DotsThree,
} from '@phosphor-icons/react'
import { slugify } from '../hooks/useNoteCreation'
import { useDragRegion } from '../hooks/useDragRegion'

interface BreadcrumbBarProps {
  entry: VaultEntry
  wordCount: number
  showDiffToggle: boolean
  diffMode: boolean
  diffLoading: boolean
  onToggleDiff: () => void
  rawMode?: boolean
  onToggleRaw?: () => void
  /** When true, raw mode is forced (non-markdown file) — hide the toggle. */
  forceRawMode?: boolean
  showAIChat?: boolean
  onToggleAIChat?: () => void
  showTableOfContents?: boolean
  onToggleTableOfContents?: () => void
  inspectorCollapsed?: boolean
  onToggleInspector?: () => void
  onToggleFavorite?: () => void
  onToggleOrganized?: () => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onExportPdf?: () => void
  onDelete?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  /** Ref for direct DOM manipulation — avoids re-render on scroll. */
  barRef?: React.Ref<HTMLDivElement>
  locale?: AppLocale
  loadingTitle?: boolean
  content?: string | null
}

const BREADCRUMB_ICON_CLASS = 'size-[16px]'

function focusFilenameInput(
  isEditing: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>,
) {
  if (!isEditing) return
  inputRef.current?.focus()
  inputRef.current?.select()
}

/** Hand keyboard focus back to the note body (handled by useEditorFocus). */
function requestEditorBodyFocus(): void {
  window.dispatchEvent(new CustomEvent('laputa:focus-editor'))
}

function beginFilenameEditing(
  onRenameFilename: BreadcrumbBarProps['onRenameFilename'],
  filenameStem: string,
  setDraftStem: (value: string) => void,
  setIsEditing: (value: boolean) => void,
) {
  if (!onRenameFilename) return
  setDraftStem(filenameStem)
  setIsEditing(true)
}

/**
 * What a submitted rename should do. `unusable` is kept distinct from `skip`
 * so the one case the user cannot diagnose — every character they typed was
 * stripped — gets an explanation instead of a name that silently snaps back.
 */
type FilenameRenameOutcome =
  | { kind: 'rename'; stem: string }
  | { kind: 'skip' }
  | { kind: 'unusable' }

function resolveFilenameRenameTarget(draftStem: string, filenameStem: string): FilenameRenameOutcome {
  const typed = draftStem.trim()
  const nextStem = normalizeFilenameStemInput(draftStem)
  if (!nextStem) return typed === '' ? { kind: 'skip' } : { kind: 'unusable' }
  if (nextStem === filenameStem) return { kind: 'skip' }
  return { kind: 'rename', stem: nextStem }
}

function handleFilenameInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  submitRename: () => void,
  cancelEditing: () => void,
) {
  switch (event.key) {
    // Enter and Down both commit and drop back into the note body (Down mirrors
    // Up-into-title).
    case 'Enter':
    case 'ArrowDown':
      event.preventDefault()
      submitRename()
      return
    case 'Escape':
      event.preventDefault()
      cancelEditing()
      return
    default:
      return
  }
}

function IconActionButton({
  copy,
  onClick,
  className,
  style,
  children,
  testId,
  tooltipAlign = 'end',
}: {
  copy: ActionTooltipCopy
  onClick?: () => void
  className?: string
  style?: CSSProperties
  children: ReactNode
  testId?: string
  tooltipAlign?: 'start' | 'center' | 'end'
}) {
  return (
    <ActionTooltip copy={copy} side="bottom" align={tooltipAlign}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn('text-muted-foreground [&_svg:not([class*=size-])]:size-4', className)}
        style={style}
        onClick={onClick}
        aria-label={copy.label}
        aria-disabled={onClick ? undefined : true}
        data-testid={testId}
      >
        {children}
      </Button>
    </ActionTooltip>
  )
}

function InspectorAction({
  inspectorCollapsed,
  locale = 'en',
  onToggleInspector,
}: Pick<BreadcrumbBarProps, 'inspectorCollapsed' | 'locale' | 'onToggleInspector'>) {
  if (!inspectorCollapsed) return null
  return (
    <IconActionButton
      copy={{
        label: translate(locale, 'editor.toolbar.openProperties'),
        shortcut: formatShortcutDisplay({ display: '⌘⇧I' }),
      }}
      onClick={onToggleInspector}
      className="hover:text-foreground"
      testId="breadcrumb-properties-button"
      tooltipAlign="end"
    >
      <SidebarSimple size={16} weight="regular" className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function availableDiffAction(showDiffToggle: boolean, onToggleDiff: () => void): (() => void) | undefined {
  return showDiffToggle ? onToggleDiff : undefined
}

function noteWidthLabelKey(noteWidth: NoteWidthMode = 'normal'): Parameters<typeof translate>[1] {
  return noteWidth === 'wide' ? 'editor.toolbar.noteWidthNormal' : 'editor.toolbar.noteWidthWide'
}

function NoteWidthMenuIcon({ noteWidth = 'normal' }: { noteWidth?: NoteWidthMode }) {
  return noteWidth === 'wide' ? <ArrowsInLineHorizontal size={16} /> : <ArrowsOutLineHorizontal size={16} />
}

function archiveLabelKey(archived: boolean): Parameters<typeof translate>[1] {
  return archived ? 'editor.toolbar.restoreArchived' : 'editor.toolbar.archive'
}

function archiveAction(
  archived: boolean,
  onArchive?: () => void,
  onUnarchive?: () => void,
): (() => void) | undefined {
  return archived ? onUnarchive : onArchive
}

function pathAction(action: ((path: string) => void) | undefined, path: string): (() => void) | undefined {
  return action ? () => action(path) : undefined
}

function entryAction(action: ((entry: VaultEntry) => void) | undefined, entry: VaultEntry): (() => void) | undefined {
  return action ? () => action(entry) : undefined
}

function ArchiveMenuIcon({ archived }: { archived: boolean }) {
  return archived ? <ArrowUUpLeft size={16} /> : <Archive size={16} />
}

function neighborhoodAction(
  entry: VaultEntry,
  onEnterNeighborhood?: (entry: VaultEntry) => void,
): (() => void) | undefined {
  return onEnterNeighborhood ? () => onEnterNeighborhood(entry) : undefined
}

function normalizeFilenameStemInput(value: string): string {
  const trimmed = value.trim().replace(/\.md$/i, '')
  // Strip path-unsafe characters rather than letting the backend reject the
  // whole rename and snap the name back to what it was.
  return sanitizeFilenameStem(trimmed)
}

function deriveSyncStem(entry: VaultEntry): string | null {
  const expectedStem = slugify(entry.title.trim())
  const filenameStem = entry.filename.replace(/\.md$/, '')
  if (!expectedStem || expectedStem === filenameStem) return null
  return expectedStem
}

interface BreadcrumbDisplayTitleState {
  hasH1: boolean
  title: string
}

function deriveContentDisplayTitleState(content?: string | null): BreadcrumbDisplayTitleState | null {
  if (typeof content !== 'string') return null
  const h1Title = extractH1TitleFromContent(content)
  if (h1Title) return { title: h1Title, hasH1: true }

  const frontmatterTitle = extractFrontmatterTitleFromContent(content)
  return frontmatterTitle ? { title: frontmatterTitle, hasH1: false } : null
}

function deriveEntryDisplayTitleState(entry: VaultEntry): BreadcrumbDisplayTitleState {
  return {
    title: entry.title.trim(),
    hasH1: entry.hasH1,
  }
}

function deriveBreadcrumbDisplayTitle(entry: VaultEntry, filenameStem: string, content?: string | null): string | null {
  if (isDefaultNoteType(entry.isA)) return null
  const displayState = deriveContentDisplayTitleState(content) ?? deriveEntryDisplayTitleState(entry)
  const displayTitle = displayState.title.trim()
  if (!displayTitle || displayState.hasH1) return null
  if (slugify(displayTitle) === slugify(filenameStem)) return null
  return displayTitle
}

function FilenameInput({
  inputRef,
  draftStem,
  locale = 'en',
  onDraftStemChange,
  onBlur,
  onKeyDown,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  draftStem: string
  locale?: AppLocale
  onDraftStemChange: (nextValue: string) => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  // Auto-size the field to its content so long titles aren't clipped: a hidden
  // mirror span (same font/padding) sets the grid track width, the input fills
  // it. Capped so it can grow until it would overlap the editor, no further.
  return (
    <span className="inline-grid min-w-[180px] max-w-[min(36rem,50vw)] items-stretch">
      <Input
        ref={inputRef}
        value={draftStem}
        onChange={(event) => onDraftStemChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="col-start-1 row-start-1 h-7 w-full border-0 bg-transparent px-0 text-lg shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-lg"
        data-testid="breadcrumb-filename-input"
        aria-label={translate(locale, 'editor.filename.rename')}
      />
      <span
        aria-hidden="true"
        data-testid="breadcrumb-filename-sizer"
        className="invisible col-start-1 row-start-1 h-7 whitespace-pre px-0 pr-2 text-lg"
      >
        {draftStem}
      </span>
    </span>
  )
}

function FilenameTrigger({
  filenameStem,
  locale = 'en',
  onStartEditing,
}: {
  filenameStem: string
  locale?: AppLocale
  onStartEditing: () => void
}) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onStartEditing()
  }, [onStartEditing])

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="h-auto min-w-0 gap-1 px-0 py-0 text-lg font-medium text-foreground hover:bg-transparent hover:text-foreground"
      onDoubleClick={onStartEditing}
      onKeyDown={handleKeyDown}
      data-testid="breadcrumb-filename-trigger"
      aria-label={translate(locale, 'editor.filename.trigger', { filename: filenameStem })}
    >
      <span className="breadcrumb-bar__filename-text truncate">{filenameStem}</span>
    </Button>
  )
}

function SyncFilenameButton({
  entryPath,
  syncStem,
  locale = 'en',
  onRenameFilename,
}: {
  entryPath: string
  syncStem: string | null
  locale?: AppLocale
  onRenameFilename?: (path: string, newFilenameStem: string) => void
}) {
  if (!syncStem || !onRenameFilename) return null
  return (
    <ActionTooltip copy={{ label: translate(locale, 'editor.filename.renameToTitle') }} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onRenameFilename(entryPath, syncStem)}
        data-testid="breadcrumb-sync-button"
        aria-label={translate(locale, 'editor.filename.renameToTitle')}
      >
        <ArrowsClockwise size={14} />
      </Button>
    </ActionTooltip>
  )
}

function FilenameDisplay({
  content,
  entry,
  filenameStem,
  syncStem,
  locale,
  onRenameFilename,
  onStartEditing,
}: {
  content?: string | null
  entry: VaultEntry
  filenameStem: string
  syncStem: string | null
  locale?: AppLocale
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  onStartEditing: () => void
}) {
  const displayTitle = deriveBreadcrumbDisplayTitle(entry, filenameStem, content)

  return (
    <div className="flex min-w-0 items-center gap-1">
      {displayTitle && (
        <>
          <span
            className="min-w-0 max-w-[min(24rem,45vw)] truncate text-foreground"
            data-testid="breadcrumb-display-title"
            title={displayTitle}
          >
            {displayTitle}
          </span>
          <span aria-hidden="true" className="shrink-0 text-border">·</span>
        </>
      )}
      <FilenameTrigger filenameStem={filenameStem} locale={locale} onStartEditing={onStartEditing} />
      <SyncFilenameButton entryPath={entry.path} syncStem={syncStem} locale={locale} onRenameFilename={onRenameFilename} />
    </div>
  )
}

function FilenameCrumb({ content, entry, locale = 'en', onRenameFilename }: Pick<BreadcrumbBarProps, 'content' | 'entry' | 'locale' | 'onRenameFilename'>) {
  const filenameStem = useMemo(() => entry.filename.replace(/\.md$/, ''), [entry.filename])
  const syncStem = useMemo(() => deriveSyncStem(entry), [entry])
  const [isEditing, setIsEditing] = useState(false)
  const [draftStem, setDraftStem] = useState(filenameStem)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    focusFilenameInput(isEditing, inputRef)
  }, [isEditing])

  const startEditing = useCallback(() => {
    beginFilenameEditing(onRenameFilename, filenameStem, setDraftStem, setIsEditing)
  }, [onRenameFilename, filenameStem])

  // Up-arrow at the top of the editor body asks to edit the title (see
  // createEditTitleOnArrowUpExtension).
  useEffect(() => {
    if (!onRenameFilename) return
    window.addEventListener(EDIT_NOTE_TITLE_EVENT, startEditing)
    return () => window.removeEventListener(EDIT_NOTE_TITLE_EVENT, startEditing)
  }, [onRenameFilename, startEditing])

  const cancelEditing = useCallback(() => {
    setDraftStem(filenameStem)
    setIsEditing(false)
  }, [filenameStem])

  const submitRename = useCallback(() => {
    setIsEditing(false)
    const outcome = resolveFilenameRenameTarget(draftStem, filenameStem)
    if (outcome.kind === 'unusable') {
      requestToast(translate(locale, 'editor.filename.n.unusable'))
      return
    }
    if (outcome.kind === 'skip') return
    onRenameFilename?.(entry.path, outcome.stem)
  }, [draftStem, filenameStem, locale, onRenameFilename, entry.path])

  // Enter/Escape return focus to the note body; blur-submit leaves focus alone
  // so clicking elsewhere doesn't yank the cursor back into the editor.
  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    handleFilenameInputKeyDown(
      event,
      () => { submitRename(); requestEditorBodyFocus() },
      () => { cancelEditing(); requestEditorBodyFocus() },
    )
  }, [submitRename, cancelEditing])

  if (isEditing) {
    return (
      <FilenameInput
        inputRef={inputRef}
        draftStem={draftStem}
        locale={locale}
        onDraftStemChange={setDraftStem}
        onBlur={submitRename}
        onKeyDown={handleInputKeyDown}
      />
    )
  }

  return (
    <FilenameDisplay
      content={content}
      entry={entry}
      filenameStem={filenameStem}
      syncStem={syncStem}
      locale={locale}
      onRenameFilename={onRenameFilename}
      onStartEditing={startEditing}
    />
  )
}

function BreadcrumbTitleSkeleton() {
  return (
    <span
      aria-hidden="true"
      data-testid="breadcrumb-title-skeleton"
      className="h-4 w-36 animate-pulse rounded bg-muted"
    />
  )
}

function BreadcrumbActions({
  entry,
  inspectorCollapsed,
  onToggleInspector,
  locale = 'en',
  ...menuProps
}: Omit<BreadcrumbBarProps, 'wordCount' | 'barRef' | 'onRenameFilename'>) {
  return (
    <div
      className="breadcrumb-bar__actions ml-auto flex shrink-0 items-center"
      style={{ gap: 8 }}
    >
      <BreadcrumbOverflowMenu entry={entry} locale={locale} {...menuProps} />
      <InspectorAction inspectorCollapsed={inspectorCollapsed} locale={locale} onToggleInspector={onToggleInspector} />
    </div>
  )
}

type BreadcrumbOverflowMenuProps = Pick<
  BreadcrumbBarProps,
  | 'entry'
  | 'showDiffToggle'
  | 'onToggleDiff'
  | 'rawMode'
  | 'onToggleRaw'
  | 'forceRawMode'
  | 'noteWidth'
  | 'onToggleNoteWidth'
  | 'showTableOfContents'
  | 'onToggleTableOfContents'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onRevealFile'
  | 'onCopyFilePath'
  | 'onCopyDeepLink'
  | 'onExportPdf'
  | 'onArchive'
  | 'onUnarchive'
  | 'onDelete'
  | 'onEnterNeighborhood'
  | 'locale'
>

function ActionMenuItem({
  onSelect,
  label,
  shortcut,
  variant,
  children,
}: {
  onSelect?: () => void
  label: string
  shortcut?: string
  variant?: 'default' | 'destructive'
  children: ReactNode
}) {
  if (!onSelect) return null
  return (
    <DropdownMenuItem variant={variant} onSelect={onSelect}>
      {children}
      {label}
      {shortcut ? <DropdownMenuShortcut aria-hidden>{shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )
}

function ToggleMenuItem({
  active,
  onSelect,
  activeLabel,
  inactiveLabel,
  shortcut,
  children,
}: {
  active: boolean
  onSelect?: () => void
  activeLabel: string
  inactiveLabel: string
  shortcut?: string
  children: ReactNode
}) {
  if (!onSelect) return null
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {children}
      {active ? activeLabel : inactiveLabel}
      {shortcut ? <DropdownMenuShortcut aria-hidden>{shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )
}

function NoteStateMenuItems({
  entry,
  rawMode,
  forceRawMode,
  onToggleFavorite,
  onToggleOrganized,
  onToggleRaw,
  locale = 'en',
}: BreadcrumbOverflowMenuProps) {
  return (
    <>
      <ToggleMenuItem
        active={entry.favorite}
        onSelect={onToggleFavorite}
        activeLabel={translate(locale, 'editor.toolbar.removeFavorite')}
        inactiveLabel={translate(locale, 'editor.toolbar.addFavorite')}
        shortcut={formatShortcutDisplay({ display: '⌘D' })}
      >
        <Star size={16} weight={entry.favorite ? 'fill' : 'regular'} />
      </ToggleMenuItem>
      <ToggleMenuItem
        active={entry.organized}
        onSelect={onToggleOrganized}
        activeLabel={translate(locale, 'editor.toolbar.markUnorganized')}
        inactiveLabel={translate(locale, 'editor.toolbar.markOrganized')}
        shortcut={formatShortcutDisplay({ display: '⌘E' })}
      >
        <CheckCircle size={16} weight={entry.organized ? 'fill' : 'regular'} />
      </ToggleMenuItem>
      {!forceRawMode && (
        <ToggleMenuItem
          active={!!rawMode}
          onSelect={onToggleRaw}
          activeLabel={translate(locale, 'editor.toolbar.rawReturn')}
          inactiveLabel={translate(locale, 'editor.toolbar.rawOpen')}
          shortcut={formatShortcutDisplay({ display: '⌘\\' })}
        >
          <Code size={16} />
        </ToggleMenuItem>
      )}
    </>
  )
}

function ViewMenuItems({
  entry,
  noteWidth,
  onToggleNoteWidth,
  showTableOfContents,
  onToggleTableOfContents,
  onEnterNeighborhood,
  locale = 'en',
}: BreadcrumbOverflowMenuProps) {
  return (
    <>
      <ActionMenuItem
        onSelect={neighborhoodAction(entry, onEnterNeighborhood)}
        label={translate(locale, 'editor.toolbar.openNeighborhood')}
      >
        <MapTrifold size={16} />
      </ActionMenuItem>
      <ActionMenuItem onSelect={onToggleNoteWidth} label={translate(locale, noteWidthLabelKey(noteWidth))}>
        <NoteWidthMenuIcon noteWidth={noteWidth} />
      </ActionMenuItem>
      <ToggleMenuItem
        active={!!showTableOfContents}
        onSelect={onToggleTableOfContents}
        activeLabel={translate(locale, 'editor.toolbar.closeTableOfContents')}
        inactiveLabel={translate(locale, 'editor.toolbar.openTableOfContents')}
        shortcut={getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleTableOfContents)}
      >
        <ListBullets size={16} weight={showTableOfContents ? 'bold' : 'regular'} />
      </ToggleMenuItem>
    </>
  )
}

function FileMenuItems({
  entry,
  showDiffToggle,
  onToggleDiff,
  onExportPdf,
  onRevealFile,
  onCopyFilePath,
  onCopyDeepLink,
  locale = 'en',
}: BreadcrumbOverflowMenuProps) {
  return (
    <>
      <ActionMenuItem
        onSelect={availableDiffAction(showDiffToggle, onToggleDiff)}
        label={translate(locale, 'editor.toolbar.gitDiff')}
      >
        <GitBranch size={16} />
      </ActionMenuItem>
      <ActionMenuItem onSelect={onExportPdf} label={translate(locale, 'editor.toolbar.exportPdf')}>
        <FilePdf size={16} />
      </ActionMenuItem>
      <ActionMenuItem
        onSelect={pathAction(onRevealFile, entry.path)}
        label={translate(locale, 'editor.toolbar.revealFile')}
      >
        <FolderOpen size={16} />
      </ActionMenuItem>
      <ActionMenuItem
        onSelect={pathAction(onCopyFilePath, entry.path)}
        label={translate(locale, 'editor.toolbar.copyFilePath')}
      >
        <ClipboardText size={16} />
      </ActionMenuItem>
      <ActionMenuItem
        onSelect={entryAction(onCopyDeepLink, entry)}
        label={translate(locale, 'editor.toolbar.copyNoteDeepLink')}
      >
        <Link size={16} />
      </ActionMenuItem>
    </>
  )
}

function LifecycleMenuItems({
  entry,
  onArchive,
  onUnarchive,
  onDelete,
  locale = 'en',
}: BreadcrumbOverflowMenuProps) {
  return (
    <>
      <ActionMenuItem
        onSelect={archiveAction(entry.archived, onArchive, onUnarchive)}
        label={translate(locale, archiveLabelKey(entry.archived))}
      >
        <ArchiveMenuIcon archived={entry.archived} />
      </ActionMenuItem>
      <ActionMenuItem onSelect={onDelete} label={translate(locale, 'editor.toolbar.delete')} variant="destructive">
        <Trash size={16} />
      </ActionMenuItem>
    </>
  )
}

function BreadcrumbOverflowMenu(props: BreadcrumbOverflowMenuProps) {
  const locale = props.locale ?? 'en'
  return (
    <DropdownMenu>
      <ActionTooltip copy={{ label: translate(locale, 'editor.toolbar.moreActions') }} side="bottom" align="end">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="breadcrumb-bar__overflow-menu text-muted-foreground hover:text-foreground"
            aria-label={translate(locale, 'editor.toolbar.moreActions')}
            data-testid="breadcrumb-overflow-menu-trigger"
          >
            <DotsThree size={18} weight="bold" className={BREADCRUMB_ICON_CLASS} />
          </Button>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="min-w-48">
        <NoteStateMenuItems {...props} />
        <ViewMenuItems {...props} />
        <FileMenuItems {...props} />
        <LifecycleMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BreadcrumbSeparator() {
  return <span aria-hidden="true" className="shrink-0 text-border">›</span>
}

function WorkspaceCrumb({ entry }: Pick<BreadcrumbBarProps, 'entry'>) {
  const workspace = entry.workspace
  if (!workspace) return null

  return (
    <>
      <WorkspaceInitialsBadge
        className="shrink-0"
        testId="breadcrumb-workspace-label"
        workspace={workspace}
      />
      <BreadcrumbSeparator />
    </>
  )
}

function BreadcrumbTitle({
  content,
  entry,
  locale,
  loadingTitle,
  onRenameFilename,
}: Pick<BreadcrumbBarProps, 'content' | 'entry' | 'locale' | 'loadingTitle' | 'onRenameFilename'>) {
  const typeLabel = entry.isA ?? 'Note'
  return (
    <div className="breadcrumb-bar__title-content flex items-center gap-1.5 min-w-0 text-sm text-muted-foreground">
      <WorkspaceCrumb entry={entry} />
      <span className="breadcrumb-bar__type shrink-0">{typeLabel}</span>
      <BreadcrumbSeparator />
      <div className="flex min-w-0 items-center gap-1 truncate">
        {loadingTitle
          ? <BreadcrumbTitleSkeleton />
          : <FilenameCrumb content={content} entry={entry} locale={locale} onRenameFilename={onRenameFilename} />}
      </div>
    </div>
  )
}

export const BreadcrumbBar = memo(function BreadcrumbBar({
  content,
  entry,
  barRef,
  locale = 'en',
  loadingTitle = false,
  onRenameFilename,
  ...actionProps
}: BreadcrumbBarProps) {
  type DragRegionResult = ReturnType<typeof useDragRegion<HTMLDivElement>> & {
    dragRegionRef?: React.RefObject<HTMLDivElement | null>
  }
  const { dragRegionRef, onMouseDown } = useDragRegion<HTMLDivElement>() as DragRegionResult
  const fallbackDragRegionRef = useRef<HTMLDivElement>(null)
  const breadcrumbDragRegionRef = dragRegionRef ?? fallbackDragRegionRef
  useImperativeHandle(barRef, () => breadcrumbDragRegionRef.current as HTMLDivElement, [breadcrumbDragRegionRef])

  useEffect(() => {
    if (dragRegionRef) return
    const bar = fallbackDragRegionRef.current
    if (!bar) return

    bar.addEventListener('mousedown', onMouseDown)
    return () => bar.removeEventListener('mousedown', onMouseDown)
  }, [dragRegionRef, onMouseDown])

  return (
    <TooltipProvider>
      <div
        ref={breadcrumbDragRegionRef}
        data-tauri-drag-region
        data-title-hidden=""
        className="breadcrumb-bar flex shrink-0 items-center border-b border-transparent"
        style={{
          height: 52,
          background: 'var(--background)',
          padding: '6px 16px 6px var(--breadcrumb-bar-left-padding, 16px)',
          boxSizing: 'border-box',
        }}
      >
        <div className="breadcrumb-bar__title min-w-0 flex-1 overflow-hidden">
          <BreadcrumbTitle
            content={content}
            entry={entry}
            locale={locale}
            loadingTitle={loadingTitle}
            onRenameFilename={onRenameFilename}
          />
        </div>
        <div
          aria-hidden="true"
          data-tauri-drag-region
          className="breadcrumb-bar__drag-spacer w-6 shrink-0"
        />
        <BreadcrumbActions
          entry={entry}
          locale={locale}
          {...actionProps}
        />
      </div>
    </TooltipProvider>
  )
})
