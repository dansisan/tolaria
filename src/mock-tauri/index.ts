/**
 * Mock Tauri invoke for browser testing.
 * When running outside Tauri (e.g. in Chrome via localhost:5173),
 * this provides realistic test data so the UI can be verified visually.
 *
 * The handlers and their ~9,000-entry fixture set load through a dynamic import so
 * they form their own chunk instead of riding in the eager entry chunk. A release
 * build never reaches `mockInvoke` — `isTauri()` is true under Tauri — so that
 * chunk is never fetched: no fixture generation during startup, no fixture memory
 * retained for the life of the process, and no `window.__mockHandlers` surface in a
 * shipped app. Dev kicks the load off at import time so browser mode and the
 * Playwright lane see the globals as early as they always have.
 *
 * `isTauri()` stays a static export with no mock dependencies, since that is all
 * most callers need.
 */

import type { VaultEntry } from '../types'

type MockHandler = (args: Record<string, unknown> | undefined) => unknown

interface MockLayer {
  mockHandlers: Record<string, MockHandler>
  addMockEntry: (entry: VaultEntry, content: string) => void
  updateMockContent: (path: string, content: string) => void
  trackMockChange: (path: string) => void
  tryVaultApi: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T | undefined>
}

let mockLayerPromise: Promise<MockLayer> | null = null

function publishMockGlobals(layer: { content: Record<string, string>; handlers: MockLayer['mockHandlers'] }): void {
  if (typeof window === 'undefined') return
  // Plain assignment, as before: the smoke lane installs `set` traps on these to
  // layer its own handler overrides on top.
  window.__mockContent = layer.content
  window.__mockHandlers = layer.handlers
}

function loadMockLayer(): Promise<MockLayer> {
  mockLayerPromise ??= Promise.all([
    import('./mock-content'),
    import('./mock-handlers'),
    import('./vault-api'),
  ]).then(([content, handlers, vaultApi]) => {
    publishMockGlobals({ content: content.MOCK_CONTENT, handlers: handlers.mockHandlers })
    return {
      mockHandlers: handlers.mockHandlers,
      addMockEntry: handlers.addMockEntry,
      updateMockContent: handlers.updateMockContent,
      trackMockChange: handlers.trackMockChange,
      tryVaultApi: vaultApi.tryVaultApi,
    }
  })
  return mockLayerPromise
}

export function isTauri(): boolean {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { isTauri?: unknown }).isTauri === 'boolean') {
    return Boolean((globalThis as { isTauri?: unknown }).isTauri)
  }

  return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
}

/**
 * Runs a mutation against the mock layer, loading it first if needed. Callers stay
 * synchronous, and ordering holds: continuations queue on the one shared promise in
 * call order, and `mockInvoke` awaits that same promise, so a mutation issued
 * before an invoke is applied before that invoke reads the handlers.
 */
function applyToMockLayer(apply: (layer: MockLayer) => void): void {
  loadMockLayer().then(apply).catch((error: unknown) => {
    console.error('Mock Tauri layer failed to load', error)
  })
}

export function addMockEntry(entry: VaultEntry, content: string): void {
  applyToMockLayer((layer) => layer.addMockEntry(entry, content))
}

export function updateMockContent(path: string, content: string): void {
  applyToMockLayer((layer) => layer.updateMockContent(path, content))
}

export function trackMockChange(path: string): void {
  applyToMockLayer((layer) => layer.trackMockChange(path))
}

function resolveMockHandler(command: string, layer: MockLayer): MockHandler | undefined {
  const windowHandler = typeof window === 'undefined' || !window.__mockHandlers
    ? undefined
    : Reflect.get(window.__mockHandlers, command) as MockHandler | undefined
  return windowHandler ?? Reflect.get(layer.mockHandlers, command) as MockHandler | undefined
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const layer = await loadMockLayer()

  const vaultResult = await layer.tryVaultApi<T>(cmd, args)
  if (vaultResult !== undefined) return vaultResult

  const handler = resolveMockHandler(cmd, layer)
  if (handler) {
    await new Promise((r) => setTimeout(r, 100))
    return handler(args) as T
  }
  throw new Error(`No mock handler for command: ${cmd}`)
}

/** `import.meta.env` is absent when this module is imported outside Vite (the
 * Playwright config graph loads it under plain Node), so read it defensively. */
function isViteDevRuntime(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean } }).env
  return env?.DEV === true
}

// Browser mode needs the globals in place as early as before; a release build
// leaves the chunk unfetched.
if (isViteDevRuntime()) void loadMockLayer()
