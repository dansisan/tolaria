import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSwapHiddenProbeEnabled, withSwapHiddenProbe } from './editorSwapLayoutProbe'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { setExpensiveCallLogging } from '../utils/expensiveCallLog'

function mountEditorContainer(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'editor__blocknote-container'
  container.style.display = 'flex'
  document.body.appendChild(container)
  return container
}

describe('editorSwapLayoutProbe', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    setExpensiveCallLogging(true)
  })

  afterEach(() => {
    setExpensiveCallLogging(null)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('stays disabled until the installation opts in', () => {
    expect(isSwapHiddenProbeEnabled()).toBe(false)

    localStorage.setItem(APP_STORAGE_KEYS.perfSwapHiddenProbe, '1')
    expect(isSwapHiddenProbeEnabled()).toBe(true)
  })

  it('stays disabled while perf logging is off, so it cannot flash in normal use', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfSwapHiddenProbe, '1')
    setExpensiveCallLogging(false)

    expect(isSwapHiddenProbeEnabled()).toBe(false)
  })

  it('runs the install untouched when the probe is off', () => {
    const container = mountEditorContainer()

    const result = withSwapHiddenProbe(() => {
      expect(container.style.display).toBe('flex')
      return 'installed'
    })

    expect(result).toEqual({ value: 'installed', hidden: false })
    expect(container.style.display).toBe('flex')
  })

  it('hides the container during the install and restores the previous display', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfSwapHiddenProbe, '1')
    const container = mountEditorContainer()
    let displayDuringInstall = ''

    const result = withSwapHiddenProbe(() => {
      displayDuringInstall = container.style.display
      return 'installed'
    })

    expect(displayDuringInstall).toBe('none')
    expect(result).toEqual({ value: 'installed', hidden: true })
    expect(container.style.display).toBe('flex')
  })

  it('restores the display even when the install throws', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfSwapHiddenProbe, '1')
    const container = mountEditorContainer()

    expect(() => withSwapHiddenProbe(() => {
      throw new Error('install failed')
    })).toThrow('install failed')

    expect(container.style.display).toBe('flex')
  })

  it('still runs the install when no editor container is mounted', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfSwapHiddenProbe, '1')

    expect(withSwapHiddenProbe(() => 'installed')).toEqual({ value: 'installed', hidden: false })
  })
})
