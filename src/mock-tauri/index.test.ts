import { afterEach, describe, expect, it } from 'vitest'
import { isTauri, mockInvoke, trackMockChange, updateMockContent } from './index'

const originalIsTauri = (globalThis as { isTauri?: unknown }).isTauri
const windowWithLegacyMarkers = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe('isTauri', () => {
  afterEach(() => {
    if (originalIsTauri === undefined) {
      delete (globalThis as { isTauri?: unknown }).isTauri
    } else {
      ;(globalThis as { isTauri?: unknown }).isTauri = originalIsTauri
    }

    delete windowWithLegacyMarkers.__TAURI__
    delete windowWithLegacyMarkers.__TAURI_INTERNALS__
  })

  it('prefers the Tauri v2 global runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = true

    expect(isTauri()).toBe(true)
  })

  it('respects an explicit false runtime flag', () => {
    ;(globalThis as { isTauri?: unknown }).isTauri = false
    windowWithLegacyMarkers.__TAURI__ = {}

    expect(isTauri()).toBe(false)
  })

  it('falls back to the legacy window markers when the runtime flag is absent', () => {
    delete (globalThis as { isTauri?: unknown }).isTauri
    windowWithLegacyMarkers.__TAURI_INTERNALS__ = {}

    expect(isTauri()).toBe(true)
  })
})

describe('lazily loaded mock layer', () => {
  it('loads handlers on first invoke and publishes the browser globals', async () => {
    const entries = await mockInvoke<{ path: string }[]>('list_vault')

    expect(entries.length).toBeGreaterThan(0)
    expect(window.__mockHandlers?.list_vault).toBeTypeOf('function')
    expect(window.__mockContent).toBeTypeOf('object')
  })

  it('still throws for an unknown command once the layer is loaded', async () => {
    await expect(mockInvoke('definitely_not_a_command')).rejects.toThrow(
      'No mock handler for command: definitely_not_a_command',
    )
  })

  it('applies a synchronous mutation before a later invoke reads the handlers', async () => {
    const path = '/Users/mock/lazy-ordering-probe.md'

    // updateMockContent stays synchronous for callers, so this must land even
    // though the layer is loaded through a promise.
    updateMockContent(path, '# Lazy ordering probe')
    trackMockChange(path)

    const content = await mockInvoke<string>('get_note_content', { path })
    expect(content).toBe('# Lazy ordering probe')
  })
})
