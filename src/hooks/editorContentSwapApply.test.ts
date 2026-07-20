import { BlockNoteEditor } from '@blocknote/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyBlocksToEditor } from './editorContentSwapApply'
import { schema } from '../components/editorSchema'

const mounted: Array<{ editor: ReturnType<typeof BlockNoteEditor.create>; element: HTMLElement }> = []

function mountEditor() {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = BlockNoteEditor.create({ schema })
  editor.mount(element)
  mounted.push({ editor, element })
  return editor
}

afterEach(() => {
  while (mounted.length) {
    const { editor, element } = mounted.pop()!
    editor.unmount()
    element.remove()
  }
})

function loadContent(editor: ReturnType<typeof BlockNoteEditor.create>, text: string) {
  applyBlocksToEditor({
    editor: editor as never,
    blocks: [{ type: 'paragraph', content: text }],
    editorContentPathRef: { current: null },
    scrollTop: 0,
    suppressChangeRef: { current: false },
    targetPath: '/note.md',
  })
}

describe('applyBlocksToEditor undo history', () => {
  it('does not let undo revert the content load and empty the note', () => {
    const editor = mountEditor()

    loadContent(editor, 'Loaded from disk')
    expect(JSON.stringify(editor.document)).toContain('Loaded from disk')

    // The editor instance is reused across notes; a recordable load would let
    // Cmd+Z revert it and empty the note. There must be nothing to undo.
    expect(editor.undo()).toBe(false)
    expect(JSON.stringify(editor.document)).toContain('Loaded from disk')
  })

  it("still lets undo revert the user's own edits after the load", () => {
    const editor = mountEditor()
    loadContent(editor, 'Original')

    editor.updateBlock(editor.document[0].id, { content: 'Edited' })
    expect(JSON.stringify(editor.document)).toContain('Edited')

    // Excluding the load from history must not disable history for real edits.
    expect(editor.undo()).toBe(true)
    expect(JSON.stringify(editor.document)).toContain('Original')
  })
})

describe('applyBlocksToEditor side menu suppression', () => {
  it('hides the side menu before swapping content, so it never recomputes position against a document that is about to disappear', () => {
    const editor = mountEditor()
    const sideMenu = editor.getExtension('sideMenu') as { unfreezeMenu?: () => void } | undefined
    expect(typeof sideMenu?.unfreezeMenu).toBe('function')
    const unfreezeSpy = vi.spyOn(sideMenu!, 'unfreezeMenu')

    loadContent(editor, 'New content')

    expect(unfreezeSpy).toHaveBeenCalled()
  })

  it('does not throw when the side menu has never shown yet (its internal state is still uninitialized)', () => {
    const editor = mountEditor()

    expect(() => loadContent(editor, 'New content')).not.toThrow()
    expect(JSON.stringify(editor.document)).toContain('New content')
  })
})
