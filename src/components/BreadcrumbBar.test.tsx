import type { ComponentProps } from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BreadcrumbBar } from './BreadcrumbBar'
import { EDIT_NOTE_TITLE_EVENT } from '../utils/editNoteTitleEvent'
import type { VaultEntry } from '../types'

const dragRegionMouseDown = vi.fn()

vi.mock('../hooks/useDragRegion', () => ({
  useDragRegion: () => ({ onMouseDown: dragRegionMouseDown }),
}))

const baseEntry: VaultEntry = {
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
}

const archivedEntry: VaultEntry = {
  ...baseEntry,
  archived: true,
}

const defaultProps = {
  wordCount: 100,
  showDiffToggle: false,
  diffMode: false,
  diffLoading: false,
  onToggleDiff: vi.fn(),
}

type BreadcrumbBarRenderProps = Omit<ComponentProps<typeof BreadcrumbBar>, 'entry'>

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return { ...baseEntry, ...overrides }
}

function renderBreadcrumb(
  entryOverrides: Partial<VaultEntry> = {},
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  const entry = makeEntry(entryOverrides)
  return {
    entry,
    ...render(<BreadcrumbBar entry={entry} {...defaultProps} {...props} />),
  }
}

function renderEditableFilenameBreadcrumb(
  entryOverrides: Partial<VaultEntry> = {},
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  const onRenameFilename = vi.fn()
  const result = renderBreadcrumb(entryOverrides, { ...props, onRenameFilename })
  return { ...result, onRenameFilename }
}

function startFilenameRename() {
  fireEvent.doubleClick(screen.getByTestId('breadcrumb-filename-trigger'))
  return screen.getByTestId('breadcrumb-filename-input')
}

function expectDisplayTitleState(
  entryOverrides: Partial<VaultEntry>,
  expected: { displayTitle: string | null; filenameStem: string },
  props: Partial<BreadcrumbBarRenderProps> = {},
) {
  renderEditableFilenameBreadcrumb(entryOverrides, props)

  if (expected.displayTitle) {
    expect(screen.getByTestId('breadcrumb-display-title')).toHaveTextContent(expected.displayTitle)
  } else {
    expect(screen.queryByTestId('breadcrumb-display-title')).not.toBeInTheDocument()
  }
  expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent(expected.filenameStem)
}

async function openOverflowMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More note actions' }), {
    button: 0,
    ctrlKey: false,
  })
  return screen.findByRole('menu')
}

async function clickMenuItem(name: string) {
  const menu = await openOverflowMenu()
  fireEvent.click(within(menu).getByRole('menuitem', { name }))
}

describe('BreadcrumbBar — drag region', () => {
  it('forwards mousedown events to the shared drag-region hook', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.querySelector('.breadcrumb-bar') as HTMLElement

    fireEvent.mouseDown(bar, { button: 0 })

    expect(dragRegionMouseDown).toHaveBeenCalledOnce()
  })

  it('has data-tauri-drag-region on the container', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.firstElementChild as HTMLElement
    expect(bar.dataset.tauriDragRegion).toBeDefined()
  })

  it('marks the center spacer as a drag region', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const spacer = container.querySelector('.breadcrumb-bar__drag-spacer')
    expect(spacer).toHaveAttribute('data-tauri-drag-region')
    expect(spacer).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('BreadcrumbBar — bar shows only the overflow menu and properties toggle', () => {
  it('keeps note actions out of the bar until the overflow menu is opened', () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        onToggleFavorite={vi.fn()}
        onToggleRaw={vi.fn()}
        rawMode={false}
        onToggleNoteWidth={vi.fn()}
        onRevealFile={vi.fn()}
        onCopyFilePath={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'More note actions' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to favorites' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open the raw editor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch to wide note width' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).not.toBeInTheDocument()
  })

  it('shows the standalone properties toggle when the inspector is collapsed', () => {
    const onToggleInspector = vi.fn()
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        inspectorCollapsed
        onToggleInspector={onToggleInspector}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open the properties panel' }))

    expect(onToggleInspector).toHaveBeenCalledOnce()
  })

  it('hides the properties toggle when the inspector is open', () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        inspectorCollapsed={false}
        onToggleInspector={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Open the properties panel' })).not.toBeInTheDocument()
  })

  it('end-aligns the overflow trigger tooltip so zoomed windows keep it inside the right edge', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)

    act(() => {
      fireEvent.focus(screen.getByRole('button', { name: 'More note actions' }))
    })

    const tooltip = await screen.findByRole('tooltip')
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute('data-align', 'end')
    expect(tooltip).toHaveTextContent('More note actions')
  })
})

describe('BreadcrumbBar — delete', () => {
  it('shows delete in the overflow menu', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Delete this note' })).toBeInTheDocument()
  })

  it('calls onDelete from the overflow menu', async () => {
    const onDelete = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onDelete={onDelete} />)
    await clickMenuItem('Delete this note')
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — archive/unarchive', () => {
  it('shows archive in the overflow menu for non-archived note', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Archive this note' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Restore this archived note' })).not.toBeInTheDocument()
  })

  it('shows unarchive in the overflow menu for archived note', async () => {
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onArchive={vi.fn()} onUnarchive={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Restore this archived note' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Archive this note' })).not.toBeInTheDocument()
  })

  it('calls onArchive from the overflow menu', async () => {
    const onArchive = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onArchive={onArchive} />)
    await clickMenuItem('Archive this note')
    expect(onArchive).toHaveBeenCalledOnce()
  })

  it('calls onUnarchive from the overflow menu', async () => {
    const onUnarchive = vi.fn()
    render(<BreadcrumbBar entry={archivedEntry} {...defaultProps} onUnarchive={onUnarchive} />)
    await clickMenuItem('Restore this archived note')
    expect(onUnarchive).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — file actions', () => {
  it('reveals the current file from the overflow menu', async () => {
    const onRevealFile = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onRevealFile={onRevealFile} />)

    await clickMenuItem('Reveal in Finder')

    expect(onRevealFile).toHaveBeenCalledWith('/vault/note/test.md')
  })

  it('copies the current file path from the overflow menu', async () => {
    const onCopyFilePath = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onCopyFilePath={onCopyFilePath} />)

    await clickMenuItem('Copy file path')

    expect(onCopyFilePath).toHaveBeenCalledWith('/vault/note/test.md')
  })

  it('copies the current note deep link from the overflow menu', async () => {
    const onCopyDeepLink = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onCopyDeepLink={onCopyDeepLink} />)

    await clickMenuItem('Copy note deeplink')

    expect(onCopyDeepLink).toHaveBeenCalledWith(baseEntry)
  })

  it('exports the current note as PDF from the overflow menu', async () => {
    const onExportPdf = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onExportPdf={onExportPdf} />)

    await clickMenuItem('Export note as PDF')

    expect(onExportPdf).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — favorite toggle', () => {
  it('calls onToggleFavorite from the overflow menu', async () => {
    const onToggleFavorite = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleFavorite={onToggleFavorite} />)

    await clickMenuItem('Add to favorites')

    expect(onToggleFavorite).toHaveBeenCalledOnce()
  })

  it('uses the remove label for already-favorited notes', async () => {
    render(<BreadcrumbBar entry={makeEntry({ favorite: true })} {...defaultProps} onToggleFavorite={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Remove from favorites' })).toBeInTheDocument()
  })

  it('hides the favorite action when no handler is provided', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const menu = await openOverflowMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Add to favorites' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — organized toggle', () => {
  it('calls onToggleOrganized from the overflow menu', async () => {
    const onToggleOrganized = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleOrganized={onToggleOrganized} />)

    await clickMenuItem('Set note as organized')

    expect(onToggleOrganized).toHaveBeenCalledOnce()
  })

  it('uses the not-organized label once the note is organized', async () => {
    render(<BreadcrumbBar entry={makeEntry({ organized: true })} {...defaultProps} onToggleOrganized={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Set note as not organized' })).toBeInTheDocument()
  })

  it('hides the organized toggle when the workflow is disabled', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const menu = await openOverflowMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Set note as organized' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — neighborhood action', () => {
  it("opens the current note's neighborhood from the overflow menu", async () => {
    const onEnterNeighborhood = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onEnterNeighborhood={onEnterNeighborhood} />)

    await clickMenuItem("Open note's neighborhood")

    expect(onEnterNeighborhood).toHaveBeenCalledWith(baseEntry)
  })
})

describe('BreadcrumbBar — raw editor toggle', () => {
  it('shows the open-raw-editor action when rawMode is off', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={false} onToggleRaw={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Open the raw editor' })).toBeInTheDocument()
  })

  it('shows the return-to-editor action when rawMode is on', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={true} onToggleRaw={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Return to the editor' })).toBeInTheDocument()
  })

  it('calls onToggleRaw when the raw action is selected', async () => {
    const onToggleRaw = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={false} onToggleRaw={onToggleRaw} />)
    await clickMenuItem('Open the raw editor')
    expect(onToggleRaw).toHaveBeenCalledOnce()
  })

  it('hides the raw action when forceRawMode is true (non-markdown file)', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode={true} onToggleRaw={vi.fn()} forceRawMode={true} />)
    const menu = await openOverflowMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Open the raw editor' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Return to the editor' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — note width toggle', () => {
  it('shows the wide width action while normal', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="normal" onToggleNoteWidth={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Switch to wide note width' })).toBeInTheDocument()
  })

  it('shows the normal width action while wide', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="wide" onToggleNoteWidth={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Switch to normal note width' })).toBeInTheDocument()
  })

  it('calls onToggleNoteWidth when the width action is selected', async () => {
    const onToggleNoteWidth = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} noteWidth="normal" onToggleNoteWidth={onToggleNoteWidth} />)
    await clickMenuItem('Switch to wide note width')
    expect(onToggleNoteWidth).toHaveBeenCalledOnce()
  })
})

describe('BreadcrumbBar — table of contents toggle', () => {
  it('shows the table of contents action and calls the toggle handler', async () => {
    const onToggleTableOfContents = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleTableOfContents={onToggleTableOfContents} />)

    await clickMenuItem('Open table of contents')

    expect(onToggleTableOfContents).toHaveBeenCalledOnce()
  })

  it('uses the close label while the table of contents panel is active', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} showTableOfContents onToggleTableOfContents={vi.fn()} />)
    const menu = await openOverflowMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Close table of contents' })).toBeInTheDocument()
  })
})

describe('BreadcrumbBar — git diff', () => {
  it('shows git diff in the overflow menu and calls the toggle when enabled', async () => {
    const onToggleDiff = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} showDiffToggle onToggleDiff={onToggleDiff} />)

    await clickMenuItem('Git diff')

    expect(onToggleDiff).toHaveBeenCalledOnce()
  })

  it('hides git diff when the diff toggle is unavailable', async () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} showDiffToggle={false} />)
    const menu = await openOverflowMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Git diff' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — overflow menu ordering', () => {
  it('leads with note state and ends with archive then delete', async () => {
    render(
      <BreadcrumbBar
        entry={baseEntry}
        {...defaultProps}
        showDiffToggle
        onToggleFavorite={vi.fn()}
        onToggleOrganized={vi.fn()}
        rawMode={false}
        onToggleRaw={vi.fn()}
        noteWidth="normal"
        onToggleNoteWidth={vi.fn()}
        onToggleTableOfContents={vi.fn()}
        onEnterNeighborhood={vi.fn()}
        onRevealFile={vi.fn()}
        onCopyFilePath={vi.fn()}
        onCopyDeepLink={vi.fn()}
        onExportPdf={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const menu = await openOverflowMenu()
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveAccessibleName('Add to favorites')
    expect(items[items.length - 2]).toHaveAccessibleName('Archive this note')
    expect(items[items.length - 1]).toHaveAccessibleName('Delete this note')
  })
})

describe('BreadcrumbBar — title in breadcrumb (always rendered, CSS-toggled)', () => {
  it('always renders title elements in the DOM', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('›')).toBeInTheDocument()
    expect(screen.getByText('test')).toBeInTheDocument()
  })

  it('shows the workspace initials label before the note type when workspace metadata is present', () => {
    renderBreadcrumb({
      isA: 'Responsibility',
      workspace: {
        id: 'brian',
        label: 'Brian',
        alias: 'brian',
        path: '/brian',
        shortLabel: 'BR',
        color: 'purple',
        icon: null,
        mounted: true,
        available: true,
        defaultForNewNotes: false,
      },
    })

    const workspaceLabel = screen.getByTestId('breadcrumb-workspace-label')
    const typeLabel = screen.getByText('Responsibility')
    expect(workspaceLabel).toHaveTextContent('BR')
    expect(workspaceLabel).toHaveAttribute('title', 'Brian (brian)')
    expect(workspaceLabel.compareDocumentPosition(typeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not render emoji note icons in the breadcrumb filename', () => {
    const entryWithEmoji = { ...baseEntry, icon: '🚀' }
    render(<BreadcrumbBar entry={entryWithEmoji} {...defaultProps} />)
    expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent('test')
    expect(screen.queryByText('🚀')).not.toBeInTheDocument()
  })

  it('does not render Phosphor note icons in the breadcrumb filename', () => {
    const entryWithPhosphor = { ...baseEntry, icon: 'cooking-pot' }
    render(<BreadcrumbBar entry={entryWithPhosphor} {...defaultProps} />)
    expect(screen.getByTestId('breadcrumb-filename-trigger')).toHaveTextContent('test')
    expect(screen.queryByTestId('breadcrumb-note-icon')).not.toBeInTheDocument()
  })

  it('falls back to "Note" when isA is null', () => {
    const entryNoType = { ...baseEntry, isA: null }
    render(<BreadcrumbBar entry={entryNoType} {...defaultProps} />)
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('separator visibility is controlled by data-title-hidden while using the shared border chrome', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const bar = container.querySelector('.breadcrumb-bar')!
    expect(bar).toHaveClass('border-b', 'border-transparent')
    expect(bar).toHaveAttribute('data-title-hidden')
  })

  it('keeps the breadcrumb title visible in raw mode', () => {
    const { container } = render(
      <BreadcrumbBar entry={baseEntry} {...defaultProps} rawMode onToggleRaw={vi.fn()} />,
    )

    expect(container.querySelector('.breadcrumb-bar')).toHaveAttribute('data-title-hidden')
  })
})

describe('BreadcrumbBar — filename controls', () => {
  it('shows a legacy display title for structured Type instances', () => {
    expectDisplayTitleState(
      {
        isA: 'Person',
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: false,
      },
      { displayTitle: 'Reference Planning Notes', filenameStem: 'ref-570' },
    )
  })

  it('uses opened content when stale metadata marks a legacy Type instance as H1-titled', () => {
    expectDisplayTitleState(
      {
        isA: 'Person',
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: true,
      },
      { displayTitle: 'Reference Planning Notes', filenameStem: 'ref-570' },
      {
        content: '---\ntitle: Reference Planning Notes\ntype: Person\n---\n\nBody without an H1.',
      },
    )
  })

  it('never shows a display title chip for the default Note type, even when a legacy title diverges from the filename', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'ref-570' },
    )
  })

  it('never shows a display title chip for the default Note type, even with stale H1 metadata', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'ref-570.md',
        hasH1: true,
      },
      { displayTitle: null, filenameStem: 'ref-570' },
      {
        content: '---\ntitle: Reference Planning Notes\ntype: Note\n---\n\n# Reference Planning Notes\n\nBody.',
      },
    )
  })

  it('keeps content-derived H1 notes focused on the filename breadcrumb', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'manual-filename.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'manual-filename' },
      {
        content: '---\ntitle: Reference Planning Notes\n---\n\n# Canonical H1\n\nBody.',
      },
    )
  })

  it('does not duplicate the display title when the filename already matches it', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'reference-planning-notes.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'reference-planning-notes' },
    )
  })

  it('does not duplicate the display title when the filename matches with spaces', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'Reference Planning Notes.md',
        hasH1: false,
      },
      { displayTitle: null, filenameStem: 'Reference Planning Notes' },
    )
  })

  it('keeps H1-titled notes focused on the filename breadcrumb', () => {
    expectDisplayTitleState(
      {
        title: 'Reference Planning Notes',
        filename: 'manual-filename.md',
        hasH1: true,
      },
      { displayTitle: null, filenameStem: 'manual-filename' },
    )
  })

  it('shows the sync button when the filename diverges from the title slug', () => {
    renderEditableFilenameBreadcrumb({ title: 'Fresh Title', filename: 'untitled-note-123.md' })
    expect(screen.getByTestId('breadcrumb-sync-button')).toBeInTheDocument()
  })

  it('hides the sync button when the filename already matches the title slug', () => {
    renderEditableFilenameBreadcrumb({ title: 'Test Note', filename: 'test-note.md' })
    expect(screen.queryByTestId('breadcrumb-sync-button')).not.toBeInTheDocument()
  })

  it('clicking the sync button renames the file to the title slug', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb({
      title: 'Fresh Title',
      filename: 'untitled-note-123.md',
    })

    fireEvent.click(screen.getByTestId('breadcrumb-sync-button'))

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'fresh-title')
  })

  it('lets keyboard users press Enter on the filename to start editing', () => {
    renderEditableFilenameBreadcrumb()

    fireEvent.keyDown(screen.getByTestId('breadcrumb-filename-trigger'), { key: 'Enter' })

    expect(screen.getByTestId('breadcrumb-filename-input')).toHaveValue('test')
  })

  it('enters title edit when the edit-note-title event fires (Up-arrow from the editor)', () => {
    renderEditableFilenameBreadcrumb()

    act(() => { window.dispatchEvent(new CustomEvent(EDIT_NOTE_TITLE_EVENT)) })

    expect(screen.getByTestId('breadcrumb-filename-input')).toHaveValue('test')
  })

  it('ignores the edit-note-title event when the filename is not renameable', () => {
    renderBreadcrumb()

    act(() => { window.dispatchEvent(new CustomEvent(EDIT_NOTE_TITLE_EVENT)) })

    expect(screen.queryByTestId('breadcrumb-filename-input')).not.toBeInTheDocument()
  })

  it('double-clicking the filename enters edit mode and Enter confirms the rename', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'renamed-file')
  })

  it('pressing Down while editing commits the rename and exits to the body', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'renamed-file')
    expect(screen.queryByTestId('breadcrumb-filename-input')).not.toBeInTheDocument()
  })

  it('pressing Escape while editing cancels the inline rename', () => {
    const { onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-file' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onRenameFilename).not.toHaveBeenCalled()
    expect(screen.queryByTestId('breadcrumb-filename-input')).not.toBeInTheDocument()
  })

  it('strips path-unsafe characters instead of failing the rename', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'What now?' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'What now')
  })

  it('skips the rename when nothing usable survives sanitizing', () => {
    const { onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: '???' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameFilename).not.toHaveBeenCalled()
  })

  it('blur confirms the inline rename when the value changed', () => {
    const { entry, onRenameFilename } = renderEditableFilenameBreadcrumb()

    const input = startFilenameRename()
    fireEvent.change(input, { target: { value: 'renamed-on-blur' } })
    fireEvent.blur(input)

    expect(onRenameFilename).toHaveBeenCalledWith(entry.path, 'renamed-on-blur')
  })
})

describe('BreadcrumbBar — action container layout', () => {
  it('actions container has ml-auto so buttons are always right-aligned', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    const actions = container.querySelector('.breadcrumb-bar__actions')
    expect(actions).toBeInTheDocument()
    expect(actions).toHaveClass('ml-auto')
    expect(actions).toHaveStyle({ gap: '8px' })
  })

  it('lets the title use the free space before the fixed drag gap', () => {
    const { container } = render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)

    expect(container.querySelector('.breadcrumb-bar__title')).toHaveClass('flex-1')
    expect(container.querySelector('.breadcrumb-bar__drag-spacer')).toHaveClass('w-6', 'shrink-0')
    expect(container.querySelector('.breadcrumb-bar__drag-spacer')).not.toHaveClass('flex-1')
  })

  it('does not render the unused backlinks or more-actions placeholders', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Backlinks are coming soon' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More note actions are coming soon' })).not.toBeInTheDocument()
  })
})

describe('BreadcrumbBar — AI panel toggle', () => {
  it('keeps the AI panel action out of the breadcrumb bar', () => {
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} />)
    expect(screen.queryByRole('button', { name: 'Open the AI panel' })).not.toBeInTheDocument()
  })

  it('does not render the breadcrumb AI panel action when a toggle callback is available', () => {
    const onToggleAIChat = vi.fn()
    render(<BreadcrumbBar entry={baseEntry} {...defaultProps} onToggleAIChat={onToggleAIChat} />)

    expect(screen.queryByRole('button', { name: 'Open the AI panel' })).not.toBeInTheDocument()
    expect(onToggleAIChat).not.toHaveBeenCalled()
  })
})
