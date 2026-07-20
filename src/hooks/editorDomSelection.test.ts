import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearEditorDomSelection, resetEditorFocusTrackingForTest } from './editorDomSelection'

function buildEditorContainer(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'editor__blocknote-container'
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'true')
  container.appendChild(editable)
  document.body.appendChild(container)
  return container
}

describe('clearEditorDomSelection', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    resetEditorFocusTrackingForTest()
  })

  it('does not read window.getSelection() when the editor has never had focus', () => {
    buildEditorContainer()
    const getSelectionSpy = vi.spyOn(window, 'getSelection')

    clearEditorDomSelection()

    expect(getSelectionSpy).not.toHaveBeenCalled()
  })

  it('reads and clears the selection once the editor has had focus', () => {
    const container = buildEditorContainer()
    const editable = container.querySelector('[contenteditable="true"]') as HTMLElement
    editable.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))

    const getSelectionSpy = vi.spyOn(window, 'getSelection')

    clearEditorDomSelection()

    expect(getSelectionSpy).toHaveBeenCalled()
  })
})
