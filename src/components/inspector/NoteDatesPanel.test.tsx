import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { NoteDatesPanel } from './NoteDatesPanel'

async function clickAddButton(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button)
  })
}

describe('NoteDatesPanel', () => {
  it('stays out of the way when the note already carries its dates', () => {
    render(<NoteDatesPanel missingKeys={[]} onAddDates={vi.fn()} />)

    expect(screen.queryByTestId('note-dates-panel')).toBeNull()
  })

  it('names the keys the note is missing', () => {
    render(<NoteDatesPanel missingKeys={['created', 'modified']} onAddDates={vi.fn()} />)

    expect(screen.getByText('This note is missing created, modified')).toBeTruthy()
  })

  it('adds the dates when pressed', async () => {
    const onAddDates = vi.fn().mockResolvedValue(undefined)
    render(<NoteDatesPanel missingKeys={['created']} onAddDates={onAddDates} />)

    await clickAddButton(screen.getByTestId('note-dates-panel-action'))

    expect(onAddDates).toHaveBeenCalledTimes(1)
  })

  it('reports a failure instead of pretending it worked', async () => {
    const onAddDates = vi.fn().mockRejectedValue(new Error('read-only vault'))
    render(<NoteDatesPanel missingKeys={['created']} onAddDates={onAddDates} />)

    await clickAddButton(screen.getByTestId('note-dates-panel-action'))

    await waitFor(() => {
      expect(screen.getByText("Couldn't add dates")).toBeTruthy()
    })
    expect(screen.getByTestId('note-dates-panel-action')).not.toHaveProperty('disabled', true)
  })

  it('cannot be pressed twice while the first press is in flight', async () => {
    let release = () => {}
    const onAddDates = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    render(<NoteDatesPanel missingKeys={['created']} onAddDates={onAddDates} />)

    await clickAddButton(screen.getByTestId('note-dates-panel-action'))

    expect(screen.getByTestId('note-dates-panel-action')).toHaveProperty('disabled', true)
    await clickAddButton(screen.getByTestId('note-dates-panel-action'))
    expect(onAddDates).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => {
      expect(screen.getByTestId('note-dates-panel-action')).toHaveProperty('disabled', false)
    })
  })
})
