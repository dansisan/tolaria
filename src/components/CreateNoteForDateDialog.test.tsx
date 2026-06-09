import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CreateNoteForDateDialog } from './CreateNoteForDateDialog'

describe('CreateNoteForDateDialog', () => {
  const NOW = new Date('2026-03-10T08:15:30')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders title and date fields when open', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    expect(screen.getByText('New Note for Date')).toBeInTheDocument()
    expect(screen.getByText('Created date')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter note title…')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<CreateNoteForDateDialog open={false} onClose={() => {}} onCreate={() => {}} />)
    expect(screen.queryByText('New Note for Date')).not.toBeInTheDocument()
  })

  it('prefills the title with the untitled-note default and enables Create', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    const titleInput = screen.getByPlaceholderText('Enter note title…') as HTMLInputElement
    expect(titleInput.value).toMatch(/^untitled-note-\d+$/)
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled()
  })

  it('disables Create when the title is cleared', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Enter note title…'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('calls onCreate with the trimmed title and the selected date at the current time of day', () => {
    const onCreate = vi.fn()
    const onClose = vi.fn()
    render(<CreateNoteForDateDialog open onClose={onClose} onCreate={onCreate} />)

    fireEvent.change(screen.getByPlaceholderText('Enter note title…'), { target: { value: '  Recap  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    const [title, createdDate] = onCreate.mock.calls[0]
    expect(title).toBe('Recap')
    expect(createdDate).toBeInstanceOf(Date)
    expect((createdDate as Date).getTime()).toBe(NOW.getTime())
    expect(onClose).toHaveBeenCalled()
  })

  it('does not submit when the title is whitespace only', () => {
    const onCreate = vi.fn()
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={onCreate} />)
    const input = screen.getByPlaceholderText('Enter note title…')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form')!)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('has no Cancel button', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('closes via the X button in the corner', () => {
    const onClose = vi.fn()
    render(<CreateNoteForDateDialog open onClose={onClose} onCreate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<CreateNoteForDateDialog open onClose={onClose} onCreate={() => {}} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Enter note title…'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('prefills the created field in the frontmatter datetime format', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    expect(screen.getByTestId('create-note-for-date-input')).toHaveValue('2026-03-10 08:15:30')
  })

  it('submits the date typed into the created field', () => {
    const onCreate = vi.fn()
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={onCreate} />)

    fireEvent.change(screen.getByPlaceholderText('Enter note title…'), { target: { value: 'Backfill' } })
    fireEvent.change(screen.getByTestId('create-note-for-date-input'), { target: { value: '2026-01-09 14:05:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const [, createdDate] = onCreate.mock.calls[0]
    expect((createdDate as Date).getTime()).toBe(new Date(2026, 0, 9, 14, 5, 0).getTime())
  })

  it('disables Create when the created field is not a valid datetime', () => {
    render(<CreateNoteForDateDialog open onClose={() => {}} onCreate={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Enter note title…'), { target: { value: 'Recap' } })
    fireEvent.change(screen.getByTestId('create-note-for-date-input'), { target: { value: 'not-a-date' } })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
