import { afterEach, describe, expect, it, vi } from 'vitest'

async function importFreshModule() {
  vi.resetModules()
  return import('./editorSaveTiming')
}

describe('editorSaveTiming', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, '__TOLARIA_AUTOSAVE_IDLE_MS')
    vi.resetModules()
  })

  it('defaults to the production backstop interval with the rename margin above it', async () => {
    const mod = await importFreshModule()
    expect(mod.AUTO_SAVE_DEBOUNCE_MS).toBe(30_000)
    expect(mod.UNTITLED_RENAME_DEBOUNCE_MS).toBe(mod.AUTO_SAVE_DEBOUNCE_MS + 1_000)
  })

  it('honors the test-harness override and keeps the rename ordering margin', async () => {
    Reflect.set(globalThis, '__TOLARIA_AUTOSAVE_IDLE_MS', 1_500)
    const mod = await importFreshModule()
    expect(mod.AUTO_SAVE_DEBOUNCE_MS).toBe(1_500)
    expect(mod.UNTITLED_RENAME_DEBOUNCE_MS).toBe(2_500)
  })

  it('ignores non-numeric and non-positive overrides', async () => {
    Reflect.set(globalThis, '__TOLARIA_AUTOSAVE_IDLE_MS', -5)
    expect((await importFreshModule()).AUTO_SAVE_DEBOUNCE_MS).toBe(30_000)
    Reflect.set(globalThis, '__TOLARIA_AUTOSAVE_IDLE_MS', 'fast')
    expect((await importFreshModule()).AUTO_SAVE_DEBOUNCE_MS).toBe(30_000)
  })
})
