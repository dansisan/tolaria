import { useLayoutEffect, useState } from 'react'

type HandlerMap = Record<string, ((...args: never[]) => unknown) | undefined>

interface StableHandlerStore {
  latest: HandlerMap
  wrappers: Map<string, (...args: never[]) => unknown>
  result: Record<string, unknown>
}

/** Per-hook-instance mutable caches, keyed by a stable per-instance sentinel. */
const storesByInstance = new WeakMap<object, StableHandlerStore>()

function storeForInstance(instanceKey: object, handlers: HandlerMap): StableHandlerStore {
  const existing = storesByInstance.get(instanceKey)
  if (existing) return existing
  const created: StableHandlerStore = { latest: handlers, wrappers: new Map(), result: {} }
  storesByInstance.set(instanceKey, created)
  return created
}

function wrapperFor(store: StableHandlerStore, key: string): (...args: never[]) => unknown {
  const existing = store.wrappers.get(key)
  if (existing) return existing
  const wrapper = (...args: never[]) => store.latest[key]?.(...args)
  store.wrappers.set(key, wrapper)
  return wrapper
}

function resolveStableResult(store: StableHandlerStore, handlers: HandlerMap): Record<string, unknown> {
  const keys = Object.keys(handlers)
  const next: Record<string, unknown> = {}
  let changed = keys.length !== Object.keys(store.result).length
  for (const key of keys) {
    next[key] = handlers[key] === undefined ? undefined : wrapperFor(store, key)
    if (store.result[key] !== next[key]) changed = true
  }
  if (changed) store.result = next
  return store.result
}

function rememberLatestHandlers(instanceKey: object, handlers: HandlerMap): void {
  storeForInstance(instanceKey, handlers).latest = handlers
}

/**
 * Returns identity-stable wrappers around a map of event handlers so that
 * memoized children (Sidebar, NoteList, StatusBar) stop re-rendering just
 * because the app re-created its callbacks. Each wrapper always invokes the
 * latest handler and forwards the return value.
 *
 * `undefined` entries stay `undefined` — several components gate UI on
 * handler presence, and a permanent wrapper would break that.
 *
 * Handlers are invoked from events (never during render), so reading the
 * latest map from the store is safe.
 */
export function useStableHandlers<T extends HandlerMap>(handlers: T): T {
  const [instanceKey] = useState<Record<never, never>>(() => ({}))
  useLayoutEffect(() => {
    rememberLatestHandlers(instanceKey, handlers)
  })
  return resolveStableResult(storeForInstance(instanceKey, handlers), handlers) as T
}
