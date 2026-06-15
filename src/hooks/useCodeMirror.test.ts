import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { useCodeMirror, type CodeMirrorCallbacks } from './useCodeMirror'

const noop = () => {}
const noopCallbacks: CodeMirrorCallbacks = {
  onDocChange: noop,
  onCursorActivity: noop,
  onSave: noop,
  onEscape: () => false,
  onFindNext: () => false,
  onFindPrevious: () => false,
}

describe('useCodeMirror', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('creates an EditorView in the container', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    expect(result.current.current).not.toBeNull()
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('does not vertically offset line numbers from editor text', () => {
    const ref = { current: container }
    renderHook(() =>
      useCodeMirror(ref, '---\ntype: Note\n---', noopCallbacks),
    )
    const gutters = container.querySelector('.cm-gutters')

    expect(gutters).toBeInTheDocument()
    expect(getComputedStyle(gutters!).paddingTop).toBe('0px')
  })

  it('tags generated CodeMirror style elements with the runtime CSP nonce', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )

    expect(result.current.current?.state.facet(EditorView.cspNonce)).toBe(RUNTIME_STYLE_NONCE)
  })

  it('enables per-line auto text direction for mixed LTR and RTL content', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'English\nمرحبا بالعالم', noopCallbacks),
    )
    const view = result.current.current!

    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true)
    expect([...container.querySelectorAll('.cm-line')].map(line => line.getAttribute('dir'))).toEqual(['auto', 'auto'])
  })

  it('calls requestMeasure when laputa-zoom-change event fires', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stops listening for zoom changes after unmount', () => {
    const ref = { current: container }
    const { result, unmount } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    unmount()

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    // After unmount, the listener should be removed — requestMeasure should NOT be called.
    // (The view is also destroyed on unmount, so this verifies cleanup.)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('syncs content prop changes to the editor', () => {
    const ref = { current: container }
    const onDocChange = vi.fn()
    const callbacks = { ...noopCallbacks, onDocChange }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, callbacks),
      { initialProps: { content: '---\ntitle: Hello\n---\nBody' } },
    )
    const view = result.current.current!
    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\n---\nBody')

    // Simulate external content update (e.g. frontmatter written to disk)
    rerender({ content: '---\ntitle: Hello\nTrashed: true\n---\nBody' })

    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\nTrashed: true\n---\nBody')
    // External sync should NOT trigger onDocChange (would cause infinite loop)
    expect(onDocChange).not.toHaveBeenCalled()
  })

  it('lets app Escape handling run before the CodeMirror default keymap', () => {
    const ref = { current: container }
    const onEscape = vi.fn(() => true)
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', { ...noopCallbacks, onEscape }),
    )
    const view = result.current.current!

    act(() => {
      view.focus()
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }))
    })

    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('routes Cmd+G and Cmd+Shift+G to the find navigation callbacks', () => {
    const ref = { current: container }
    const onFindNext = vi.fn(() => true)
    const onFindPrevious = vi.fn(() => true)
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', { ...noopCallbacks, onFindNext, onFindPrevious }),
    )
    const view = result.current.current!

    // CodeMirror maps `Mod` to Cmd on macOS and Ctrl elsewhere; match the
    // platform the same way so the test works on dev Macs and Linux CI alike.
    const platformMod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
    const dispatchKey = (init: KeyboardEventInit) => {
      act(() => {
        view.focus()
        view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        }))
      })
    }

    // keyCode 71 ('g') lets CodeMirror recover the base key for the shifted
    // binding, exactly as a real browser reports it.
    dispatchKey({ key: 'g', code: 'KeyG', keyCode: 71, ...platformMod })
    expect(onFindNext).toHaveBeenCalledOnce()
    expect(onFindPrevious).not.toHaveBeenCalled()

    dispatchKey({ key: 'G', code: 'KeyG', keyCode: 71, ...platformMod, shiftKey: true })
    expect(onFindPrevious).toHaveBeenCalledOnce()
  })

  it('does not sync when content matches current editor state', () => {
    const ref = { current: container }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, noopCallbacks),
      { initialProps: { content: 'hello' } },
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'dispatch')

    // Re-render with same content — no dispatch needed
    rerender({ content: 'hello' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('installs zoomCursorFix that overrides posAtCoords on the view instance', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    const view = result.current.current!
    // The extension overrides posAtCoords on the instance (not the prototype)
    expect(Object.hasOwn(view, 'posAtCoords')).toBe(true)
  })
})
