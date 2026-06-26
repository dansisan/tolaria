import type { ComponentType, CSSProperties, MouseEvent as ReactMouseEvent, MouseEventHandler, ReactNode, SVGAttributes } from 'react'
import type { VaultEntry, NoteStatus } from '../types'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Wrench, Flask, Target, ArrowsClockwise,
  Users, CalendarBlank, Tag, FileText, StackSimple,
  File, FileDashed, FilePdf, ImageSquare, SpeakerHigh, Video,
} from '@phosphor-icons/react'
import { getTypeColor } from '../utils/typeColors'
import { resolveIcon } from '../utils/iconRegistry'
import { getDisplayDate } from '../utils/noteListHelpers'
import { formatFileSize } from '../utils/fileSize'
import { formatRelativeTime, formatTimestampForDateDisplay } from '../utils/dateDisplay'
import { filePreviewKind, type FilePreviewKind } from '../utils/filePreview'
import { NoteTitleIcon } from './NoteTitleIcon'
import { PropertyChips } from './note-item/PropertyChips'
import { ChangeNoteContent } from './note-item/ChangeNoteContent'
import { workspaceForEntry } from '../utils/workspaces'
import { WorkspaceInitialsBadge } from './WorkspaceInitialsBadge'
import { useDateDisplayFormat } from '../hooks/useAppPreferences'

const TYPE_ICON_MAP: Record<string, ComponentType<SVGAttributes<SVGSVGElement>>> = {
  Project: Wrench,
  Experiment: Flask,
  Responsibility: Target,
  Procedure: ArrowsClockwise,
  Person: Users,
  Event: CalendarBlank,
  Topic: Tag,
  Type: StackSimple,
}

// eslint-disable-next-line react-refresh/only-export-components -- utility co-located with component
export function getTypeIcon(isA: string | null, customIcon?: string | null): ComponentType<SVGAttributes<SVGSVGElement>> {
  if (customIcon) return resolveIcon(customIcon)
  return (isA && (Reflect.get(TYPE_ICON_MAP, isA) as ComponentType<SVGAttributes<SVGSVGElement>> | undefined)) || FileText
}

type VisibleNoteStatus = Exclude<NoteStatus, 'clean'>

const NOTE_STATUS_DOT: Record<VisibleNoteStatus, { color: string; testId: string; title: string }> = {
  pendingSave: { color: 'var(--accent-green)', testId: 'pending-save-indicator', title: 'Saving to disk…' },
  unsaved: { color: 'var(--accent-green)', testId: 'unsaved-indicator', title: 'Saving to disk…' },
  new: { color: 'var(--accent-green)', testId: 'new-indicator', title: 'New (uncommitted)' },
  modified: { color: 'var(--accent-orange)', testId: 'modified-indicator', title: 'Modified (uncommitted)' },
}

function hasStatusDot(noteStatus: NoteStatus): noteStatus is VisibleNoteStatus {
  return noteStatus !== 'clean'
}

function StatusDot({ noteStatus }: { noteStatus: VisibleNoteStatus }) {
  const dot = Reflect.get(NOTE_STATUS_DOT, noteStatus) as { color: string; testId: string; title: string }
  return (
    <span
      className="mr-1.5 inline-block align-middle"
      style={{ width: 6, height: 6, borderRadius: '50%', background: dot.color, verticalAlign: 'middle' }}
      data-testid={dot.testId}
      title={dot.title}
    />
  )
}

function StateBadge({ archived }: { archived: boolean }) {
  if (archived) {
    return (
      <span className="ml-1.5 inline-block align-middle text-muted-foreground" style={{ fontSize: 9, fontWeight: 500, background: 'var(--muted)', borderRadius: 4, padding: '1px 4px', verticalAlign: 'middle' }}>
        ARCHIVED
      </span>
    )
  }
  return null
}

function WorkspaceBadge({ entry, allEntries }: { entry: VaultEntry; allEntries: VaultEntry[] }) {
  const workspace = workspaceForEntry(entry)
  const hasMultipleWorkspaces = new Set(allEntries.map((candidate) => candidate.workspace?.alias).filter(Boolean)).size > 1
  if (!workspace || !hasMultipleWorkspaces) return null
  return <WorkspaceInitialsBadge workspace={workspace} className="-mr-1.5" testId="workspace-badge" />
}

type NoteItemVisualState = {
  isUnavailableBinary: boolean
  isSelected: boolean
  isMultiSelected: boolean
  isHighlighted: boolean
}

type NoteItemRowState = 'binary' | 'multiSelected' | 'selected' | 'highlighted' | 'default'

type NoteItemSurfaceProps = {
  className: string
  style: CSSProperties
  onClick: MouseEventHandler<HTMLDivElement>
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onMouseEnter?: () => void
  title?: string
  testId?: string
}

const NOTE_ITEM_BASE_CLASS_NAME = 'relative w-full border-0 border-b border-r border-[var(--border)] bg-transparent p-0 text-left transition-colors'
const BINARY_NOTE_STYLE: CSSProperties = { padding: '14px 16px' }
const NOTE_ITEM_ROW_CLASS_NAMES: Record<NoteItemRowState, string> = {
  binary: 'cursor-default opacity-50',
  multiSelected: 'cursor-pointer',
  selected: 'cursor-pointer border-l-[3px]',
  highlighted: 'cursor-pointer bg-muted',
  default: 'cursor-pointer',
}

function resolveNoteItemRowState({ isUnavailableBinary, isSelected, isMultiSelected, isHighlighted }: NoteItemVisualState): NoteItemRowState {
  if (isUnavailableBinary) return 'binary'
  if (isMultiSelected) return 'multiSelected'
  if (isSelected) return 'selected'
  if (isHighlighted) return 'highlighted'
  return 'default'
}

function noteItemClassName(state: NoteItemVisualState) {
  return cn(NOTE_ITEM_BASE_CLASS_NAME, NOTE_ITEM_ROW_CLASS_NAMES[resolveNoteItemRowState(state)])
}

function NoteTypeIndicator({
  TypeIcon,
  typeColor,
  filePreviewKind,
}: {
  TypeIcon: ComponentType<SVGAttributes<SVGSVGElement>>
  typeColor: string
  filePreviewKind?: FilePreviewKind
}) {
  return (
    <TypeIcon
      width={14}
      height={14}
      className="absolute right-3 top-2.5"
      style={{ color: typeColor }}
      data-testid="type-icon"
      data-file-preview-kind={filePreviewKind}
    />
  )
}

function BinaryFileSize({ fileSize }: { fileSize: number }) {
  if (!fileSize) return null

  return (
    <div className="text-[10px] text-muted-foreground" data-testid="note-file-size">
      {formatFileSize(fileSize)}
    </div>
  )
}

function NoteSnippet({ snippet }: { snippet?: string | null }) {
  if (!snippet) return null

  return (
    <div
      className="text-[12px] leading-[1.5] text-muted-foreground"
      data-testid="note-snippet"
      style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
    >
      {snippet}
    </div>
  )
}

function NotePropertySection({
  entry,
  displayProps,
  allEntries,
  typeEntryMap,
  onClickNote,
}: {
  entry: VaultEntry
  displayProps: string[]
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  onClickNote: NoteItemProps['onClickNote']
}) {
  if (displayProps.length === 0) return null

  return (
    <PropertyChips
      entry={entry}
      displayProps={displayProps}
      allEntries={allEntries}
      typeEntryMap={typeEntryMap}
      onOpenNote={onClickNote}
    />
  )
}

function InteractiveNoteDetails({
  entry,
  noteStatus,
  isSelected,
  displayProps,
  allEntries,
  typeEntryMap,
  onClickNote,
  sortedByModified,
}: {
  entry: VaultEntry
  noteStatus: NoteStatus
  isSelected: boolean
  displayProps: string[]
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  onClickNote: NoteItemProps['onClickNote']
  sortedByModified: boolean
}) {
  return (
    <>
      <NoteTitleRow
        entry={entry}
        isBinary={false}
        isSelected={isSelected}
        noteStatus={noteStatus}
      />
      <NoteSnippet snippet={entry.snippet} />
      <NotePropertySection
        entry={entry}
        displayProps={displayProps}
        allEntries={allEntries}
        typeEntryMap={typeEntryMap}
        onClickNote={onClickNote}
      />
      <NoteDateRow entry={entry} allEntries={allEntries} sortedByModified={sortedByModified} />
    </>
  )
}

function resolveNoteTypeIcon(entry: VaultEntry, customIcon?: string | null): ComponentType<SVGAttributes<SVGSVGElement>> {
  const previewKind = filePreviewKind(entry)
  if (previewKind === 'image') return ImageSquare
  if (previewKind === 'pdf') return FilePdf
  if (previewKind === 'audio') return SpeakerHigh
  if (previewKind === 'video') return Video
  if (entry.fileKind && entry.fileKind !== 'markdown') return getFileKindIcon(entry.fileKind)
  return getTypeIcon(entry.isA, customIcon)
}

function StandardNoteContent({
  entry,
  isBinary,
  isUnavailableBinary,
  noteStatus,
  isSelected,
  typeColor,
  displayProps,
  allEntries,
  typeEntryMap,
  onClickNote,
  sortedByModified,
}: {
  entry: VaultEntry
  isBinary: boolean
  isUnavailableBinary: boolean
  noteStatus: NoteStatus
  isSelected: boolean
  typeColor: string
  displayProps: string[]
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  onClickNote: NoteItemProps['onClickNote']
  sortedByModified: boolean
}) {
  const te = typeEntryMap[entry.isA ?? '']
  const TypeIcon = resolveNoteTypeIcon(entry, te?.icon)
  const previewKind = filePreviewKind(entry) ?? undefined

  return (
    <>
      <NoteTypeIndicator TypeIcon={TypeIcon} typeColor={typeColor} filePreviewKind={previewKind} />
      <div className="space-y-2" data-testid="note-content-stack">
        {isBinary ? (
          <>
            <NoteTitleRow
              entry={entry}
              isBinary={isUnavailableBinary}
              isSelected={isSelected}
              noteStatus={noteStatus}
            />
            <BinaryFileSize fileSize={entry.fileSize} />
          </>
        ) : (
          <InteractiveNoteDetails
            entry={entry}
            noteStatus={noteStatus}
            isSelected={isSelected}
            displayProps={displayProps}
            allEntries={allEntries}
            typeEntryMap={typeEntryMap}
            onClickNote={onClickNote}
            sortedByModified={sortedByModified}
          />
        )}
      </div>
    </>
  )
}

function NoteTitleRow({
  entry,
  isBinary,
  isSelected,
  noteStatus,
}: {
  entry: VaultEntry
  isBinary: boolean
  isSelected: boolean
  noteStatus: NoteStatus
}) {
  return (
    <div
      className={cn('truncate pr-5 text-[13px]', isBinary ? 'text-muted-foreground' : 'text-foreground', isSelected && !isBinary ? 'font-semibold' : 'font-medium')}
      data-testid="note-title-row"
    >
      {hasStatusDot(noteStatus) && !isBinary && <StatusDot noteStatus={noteStatus} />}
      <NoteTitleIcon icon={entry.icon} size={15} className="mr-1" testId="note-title-icon" />
      {entry.title}
      {!isBinary && <StateBadge archived={entry.archived} />}
    </div>
  )
}

function NoteDateRow({
  entry,
  allEntries,
  sortedByModified,
}: {
  entry: VaultEntry
  allEntries: VaultEntry[]
  sortedByModified: boolean
}) {
  const dateDisplayFormat = useDateDisplayFormat()
  // Right side: the created date by default, or the modified date when sorting
  // by it — with the day of week, right-justified, no "Created"/"Modified" label.
  const timestamp = sortedByModified ? getDisplayDate(entry) : (entry.createdAt ?? getDisplayDate(entry))
  const dateLabel = formatTimestampForDateDisplay(timestamp, dateDisplayFormat, true, true)
  // Left side: a relative "time since modified" descriptor.
  const relativeLabel = formatRelativeTime(getDisplayDate(entry))

  if (!dateLabel && !relativeLabel) return null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[10px] text-muted-foreground" data-testid="note-date-row">
      <span>{relativeLabel}</span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right">
        {dateLabel && <span>{dateLabel}</span>}
        <WorkspaceBadge entry={entry} allEntries={allEntries} />
      </span>
    </div>
  )
}

// The selected row always keeps its 3px left border as the focus signal. The
// border (and a matching row tint) is the active-selection blue while the note
// list panel holds focus, and switches to a neutral grey once focus moves to
// the editor. When inactive the fill is --surface-card, which is lighter than
// the list background (--surface-sidebar) in both themes, so the selected row
// recedes as a soft raised tile rather than drawing attention away from the
// editor, which is where keystrokes now go. Both colours are type-independent,
// so the flip reads on every note.
function selectedRowColors(isPanelActive: boolean): CSSProperties {
  if (isPanelActive) return { borderLeftColor: 'var(--border-focus)', backgroundColor: 'var(--state-selected)' }
  return { borderLeftColor: 'var(--muted-foreground)', backgroundColor: 'var(--surface-card)' }
}

function noteItemStyle({ isSelected, isMultiSelected, isPanelActive }: {
  isSelected: boolean
  isMultiSelected: boolean
  isPanelActive: boolean
}): CSSProperties {
  const base: CSSProperties = { padding: isSelected && !isMultiSelected ? '14px 16px 14px 13px' : '14px 16px' }
  if (isMultiSelected) base.backgroundColor = 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'
  else if (isSelected) Object.assign(base, selectedRowColors(isPanelActive))
  return base
}

function getFileKindIcon(fileKind: string | undefined): ComponentType<SVGAttributes<SVGSVGElement>> {
  if (fileKind === 'text') return File
  if (fileKind === 'binary') return FileDashed
  return FileText
}

function resolveDisplayProps(entry: VaultEntry, typeEntryMap: Record<string, VaultEntry>, displayPropsOverride?: string[] | null): string[] {
  if (displayPropsOverride && displayPropsOverride.length > 0) return displayPropsOverride
  return typeEntryMap[entry.isA ?? '']?.listPropertiesDisplay ?? []
}

type NoteItemProps = {
  entry: VaultEntry
  isSelected: boolean
  isMultiSelected?: boolean
  /** When true, bulk mode is active: a leading checkbox is shown on every row. */
  isMultiSelectActive?: boolean
  isHighlighted?: boolean
  /** Whether the note list panel currently holds focus; drives the selected row's active vs. dimmed treatment. */
  isPanelActive?: boolean
  noteStatus?: NoteStatus
  /** When set, renders in Changes-view style: filename + change type icon */
  changeStatus?: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
  typeEntryMap: Record<string, VaultEntry>
  allEntries?: VaultEntry[]
  displayPropsOverride?: string[] | null
  /** When sorting by modified date, show that date; otherwise show the created date. */
  sortedByModified?: boolean
  onClickNote: (entry: VaultEntry, e: ReactMouseEvent) => void
  onPrefetch?: (entry: VaultEntry) => void
  onContextMenu?: (entry: VaultEntry, e: ReactMouseEvent) => void
}

function createNoteItemClickHandler(
  entry: VaultEntry,
  isUnavailableBinary: boolean,
  onClickNote: NoteItemProps['onClickNote'],
) {
  const isPropertyChipTarget = (event: ReactMouseEvent) =>
    event.target instanceof Element && event.target.closest('[data-property-chip="true"]') !== null

  if (isUnavailableBinary) {
    return (event: ReactMouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  return (event: ReactMouseEvent) => {
    if (isPropertyChipTarget(event)) return
    onClickNote(entry, event)
  }
}

function resolveNoteItemSurfaceStyle({
  isUnavailableBinary,
  isSelected,
  isMultiSelected,
  isPanelActive,
}: Pick<NoteItemVisualState, 'isUnavailableBinary' | 'isSelected' | 'isMultiSelected'> & {
  isPanelActive: boolean
}) {
  if (isUnavailableBinary) return BINARY_NOTE_STYLE
  return noteItemStyle({ isSelected, isMultiSelected, isPanelActive })
}

function resolveNoteItemTestId({
  isMultiSelected,
  previewKind,
  isUnavailableBinary,
}: Pick<NoteItemVisualState, 'isMultiSelected' | 'isUnavailableBinary'> & {
  previewKind: FilePreviewKind | null
}) {
  if (isMultiSelected) return 'multi-selected-item'
  if (previewKind) return `${previewKind}-file-item`
  return isUnavailableBinary ? 'binary-file-item' : undefined
}

function resolveNoteItemTitle({
  previewKind,
  isUnavailableBinary,
}: Pick<NoteItemVisualState, 'isUnavailableBinary'> & {
  previewKind: FilePreviewKind | null
}) {
  if (previewKind === 'image') return 'Open image preview'
  if (previewKind === 'pdf') return 'Open PDF preview'
  if (previewKind === 'audio') return 'Open audio preview'
  if (previewKind === 'video') return 'Open video preview'
  return isUnavailableBinary ? 'Cannot open this file type' : undefined
}

function resolveNoteItemSurfaceProps({
  entry,
  isUnavailableBinary,
  previewKind,
  isSelected,
  isMultiSelected,
  isHighlighted,
  isPanelActive,
  onClickNote,
  onPrefetch,
  onContextMenu,
}: NoteItemVisualState & {
  entry: VaultEntry
  previewKind: FilePreviewKind | null
  isPanelActive: boolean
  onClickNote: NoteItemProps['onClickNote']
  onPrefetch?: NoteItemProps['onPrefetch']
  onContextMenu?: NoteItemProps['onContextMenu']
}): NoteItemSurfaceProps {
  return {
    className: noteItemClassName({ isUnavailableBinary, isSelected, isMultiSelected, isHighlighted }),
    style: resolveNoteItemSurfaceStyle({ isUnavailableBinary, isSelected, isMultiSelected, isPanelActive }),
    onClick: createNoteItemClickHandler(entry, isUnavailableBinary, onClickNote),
    onContextMenu: onContextMenu ? (event) => onContextMenu(entry, event) : undefined,
    onMouseEnter: entry.fileKind !== 'binary' && onPrefetch ? () => onPrefetch(entry) : undefined,
    testId: resolveNoteItemTestId({ isMultiSelected, previewKind, isUnavailableBinary }),
    title: resolveNoteItemTitle({ previewKind, isUnavailableBinary }),
  }
}

/** Decorative checkbox shown in bulk mode; the surrounding row handles the click/toggle. */
function RowSelectionCheckbox({ checked }: { checked: boolean }) {
  return (
    <Checkbox
      checked={checked}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none mt-0.5 shrink-0"
      data-testid="note-item-checkbox"
    />
  )
}

function NoteItemRow({
  surfaceProps,
  entryPath,
  isSelected,
  isMultiSelected,
  isMultiSelectActive,
  isHighlighted,
  changeStatus,
  children,
}: {
  surfaceProps: NoteItemSurfaceProps
  entryPath: string
  isSelected: boolean
  isMultiSelected: boolean
  isMultiSelectActive: boolean
  isHighlighted: boolean
  changeStatus: NoteItemProps['changeStatus']
  children: ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={isSelected || isMultiSelected}
      className={surfaceProps.className}
      style={surfaceProps.style}
      onClick={surfaceProps.onClick}
      onContextMenu={surfaceProps.onContextMenu}
      onMouseEnter={surfaceProps.onMouseEnter}
      data-testid={surfaceProps.testId}
      data-highlighted={isHighlighted || undefined}
      data-note-path={entryPath}
      data-change-status={changeStatus}
      title={surfaceProps.title}
    >
      {isMultiSelectActive ? (
        <div className="flex items-start gap-3">
          <RowSelectionCheckbox checked={isMultiSelected} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : children}
    </div>
  )
}

function NoteItemContent({
  entry,
  isBinary,
  isUnavailableBinary,
  isSelected,
  noteStatus,
  changeStatus,
  typeColor,
  displayProps,
  allEntries,
  typeEntryMap,
  onClickNote,
  sortedByModified,
}: {
  entry: VaultEntry
  isBinary: boolean
  isUnavailableBinary: boolean
  isSelected: boolean
  noteStatus: NoteStatus
  changeStatus?: NoteItemProps['changeStatus']
  typeColor: string
  displayProps: string[]
  allEntries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  onClickNote: NoteItemProps['onClickNote']
  sortedByModified: boolean
}) {
  if (changeStatus) {
    return (
      <ChangeNoteContent
        entry={entry}
        changeStatus={changeStatus}
        isSelected={isSelected}
        isDeletedChange={changeStatus === 'deleted'}
      />
    )
  }

  return (
    <StandardNoteContent
      entry={entry}
      isBinary={isBinary}
      isUnavailableBinary={isUnavailableBinary}
      noteStatus={noteStatus}
      isSelected={isSelected}
      typeColor={typeColor}
      displayProps={displayProps}
      allEntries={allEntries}
      typeEntryMap={typeEntryMap}
      onClickNote={onClickNote}
      sortedByModified={sortedByModified}
    />
  )
}

export function NoteItem({ entry, isSelected, isMultiSelected = false, isMultiSelectActive = false, isHighlighted = false, isPanelActive = true, noteStatus = 'clean', changeStatus, typeEntryMap, allEntries, displayPropsOverride, sortedByModified = false, onClickNote, onPrefetch, onContextMenu }: NoteItemProps) {
  const isBinary = entry.fileKind === 'binary'
  const previewKind = filePreviewKind(entry)
  const isPreviewableFile = previewKind !== null
  const isUnavailableBinary = isBinary && !isPreviewableFile
  const te = typeEntryMap[entry.isA ?? '']
  const displayProps = resolveDisplayProps(entry, typeEntryMap, displayPropsOverride)
  const typeColor = isPreviewableFile ? 'var(--accent-blue)' : isBinary ? 'var(--muted-foreground)' : getTypeColor(entry.isA ?? 'Note', te?.color)
  const surfaceProps = resolveNoteItemSurfaceProps({
    entry,
    isUnavailableBinary,
    previewKind,
    isSelected,
    isMultiSelected,
    isHighlighted,
    isPanelActive,
    onClickNote,
    onPrefetch,
    onContextMenu,
  })

  return (
    <NoteItemRow
      surfaceProps={surfaceProps}
      entryPath={entry.path}
      isSelected={isSelected}
      isMultiSelected={isMultiSelected}
      isMultiSelectActive={isMultiSelectActive}
      isHighlighted={isHighlighted}
      changeStatus={changeStatus}
    >
      <NoteItemContent
        entry={entry}
        isBinary={isBinary}
        isUnavailableBinary={isUnavailableBinary}
        isSelected={isSelected}
        noteStatus={noteStatus}
        changeStatus={changeStatus}
        typeColor={typeColor}
        displayProps={displayProps}
        allEntries={allEntries ?? [entry]}
        typeEntryMap={typeEntryMap}
        onClickNote={onClickNote}
        sortedByModified={sortedByModified}
      />
    </NoteItemRow>
  )
}
