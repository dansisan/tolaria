import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ImportAppleNotesDialog, type AppleNotesFolder } from './ImportAppleNotesDialog'

const FOLDERS: AppleNotesFolder[] = [
  { account: 'iCloud', name: 'Notes', count: 81 },
  { account: 'iCloud', name: 'journ', count: 2 },
  { account: 'iCloud', name: 'Imported Notes', count: 1721 },
]

function renderDialog(overrides: Partial<Parameters<typeof ImportAppleNotesDialog>[0]> = {}) {
  const onImport = vi.fn()
  const onClose = vi.fn()
  const fetchFolders = vi.fn().mockResolvedValue(FOLDERS)
  render(
    <ImportAppleNotesDialog
      open={true}
      locale="en"
      fetchFolders={fetchFolders}
      onImport={onImport}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { onImport, onClose, fetchFolders }
}

describe('ImportAppleNotesDialog', () => {
  it('lists each folder with its account and note count once loaded', async () => {
    renderDialog()
    expect(await screen.findByTestId('import-apple-notes-options')).toBeInTheDocument()
    expect(screen.getByText('journ')).toBeInTheDocument()
    expect(screen.getByText('81 notes')).toBeInTheDocument()
    expect(screen.getByText('1721 notes')).toBeInTheDocument()
  })

  it('defaults to all folders selected and imports them with their total on confirm', async () => {
    const { onImport } = renderDialog()
    await screen.findByTestId('import-apple-notes-options')
    // 81 + 2 + 1721 = 1804
    const confirm = screen.getByTestId('import-apple-notes-confirm')
    expect(confirm).toHaveTextContent('Import 1804 notes')
    fireEvent.click(confirm)
    expect(onImport).toHaveBeenCalledWith(FOLDERS)
  })

  it('excludes a folder once unticked, updating the count and the imported set', async () => {
    const { onImport } = renderDialog()
    await screen.findByTestId('import-apple-notes-options')
    const bigFolder = screen.getByTestId('import-apple-notes-option:iCloud/Imported Notes')
    fireEvent.click(bigFolder.querySelector('input[type="checkbox"]')!)
    const confirm = screen.getByTestId('import-apple-notes-confirm')
    expect(confirm).toHaveTextContent('Import 83 notes')
    fireEvent.click(confirm)
    expect(onImport).toHaveBeenCalledWith([
      { account: 'iCloud', name: 'Notes', count: 81 },
      { account: 'iCloud', name: 'journ', count: 2 },
    ])
  })

  it('disables the confirm button when no folder is selected', async () => {
    renderDialog()
    await screen.findByTestId('import-apple-notes-options')
    for (const folder of FOLDERS) {
      const row = screen.getByTestId(`import-apple-notes-option:${folder.account}/${folder.name}`)
      fireEvent.click(row.querySelector('input[type="checkbox"]')!)
    }
    expect(screen.getByTestId('import-apple-notes-confirm')).toBeDisabled()
  })

  it('shows an error with a retry that refetches', async () => {
    const fetchFolders = vi
      .fn()
      .mockRejectedValueOnce('Notes not running')
      .mockResolvedValueOnce(FOLDERS)
    renderDialog({ fetchFolders })
    expect(await screen.findByTestId('import-apple-notes-error')).toHaveTextContent('Notes not running')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('import-apple-notes-options')).toBeInTheDocument()
    expect(fetchFolders).toHaveBeenCalledTimes(2)
  })

  it('explains that Quick Notes are excluded once folders load', async () => {
    renderDialog()
    const hint = await screen.findByTestId('import-apple-notes-quick-notes-hint')
    expect(hint).toHaveTextContent('Quick Notes')
    expect(hint).toHaveTextContent('Move them into a folder')
  })

  it('shows an empty message when there are no folders', async () => {
    renderDialog({ fetchFolders: vi.fn().mockResolvedValue([]) })
    expect(await screen.findByTestId('import-apple-notes-empty')).toBeInTheDocument()
  })

  it('does not fetch while closed', () => {
    const fetchFolders = vi.fn().mockResolvedValue(FOLDERS)
    render(
      <ImportAppleNotesDialog
        open={false}
        locale="en"
        fetchFolders={fetchFolders}
        onImport={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(fetchFolders).not.toHaveBeenCalled()
  })
})
