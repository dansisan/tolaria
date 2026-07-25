import type { EditorState } from 'prosemirror-state'
import type { DecorationSet } from 'prosemirror-view'
import { elapsedSince, isExpensiveCallLoggingEnabled, startExpensiveCall } from '../utils/expensiveCallLog'

/**
 * Attributes decorations to the plugin that produced them.
 *
 * A document install is dominated by applying decorations, not by node count —
 * building the same document with no plugins is orders of magnitude cheaper. The
 * view asks every plugin for its `decorations` prop and merges the results, so
 * counting each plugin's contribution names the expensive one directly.
 *
 * This calls the same pure prop the view calls and mutates nothing, so unlike a
 * second EditorView it cannot perturb plugin state.
 */
interface DecorationCount {
  plugin: string
  decorations: number
  ms: number
}

interface KeyedPlugin {
  key?: string
  props?: {
    decorations?: (state: EditorState) => DecorationSet | null | undefined
  }
}

interface DecorationSetWithFind {
  find?: () => unknown[]
}

function pluginName(plugin: KeyedPlugin, index: number): string {
  // ProseMirror keys look like "inlineTags$" / "inlineTags$1"; strip the marker.
  const key = plugin.key?.replace(/\$\d*$/, '')
  return key && key.length > 0 ? key : `plugin${index}`
}

function countDecorations(set: DecorationSet | null | undefined): number {
  const finder = set as DecorationSetWithFind | null | undefined
  if (!finder || typeof finder.find !== 'function') return 0
  return finder.find().length
}

function measurePlugin(plugin: KeyedPlugin, index: number, state: EditorState): DecorationCount | null {
  const decorationsProp = plugin.props?.decorations
  if (typeof decorationsProp !== 'function') return null

  const startedAt = startExpensiveCall()
  try {
    const decorations = countDecorations(decorationsProp.call(plugin, state))
    return { plugin: pluginName(plugin, index), decorations, ms: elapsedSince(startedAt) }
  } catch {
    // A plugin may assume a live view; skip it rather than break the swap.
    return null
  }
}

/** Decoration counts per plugin, biggest first. Empty when diagnostics are off. */
export function attributeDecorations(state: EditorState | null | undefined): DecorationCount[] {
  if (!state || !isExpensiveCallLoggingEnabled()) return []

  const plugins = state.plugins as unknown as KeyedPlugin[]
  return plugins
    .map((plugin, index) => measurePlugin(plugin, index, state))
    .filter((count): count is DecorationCount => count !== null && count.decorations > 0)
    .sort((a, b) => b.decorations - a.decorations || a.plugin.localeCompare(b.plugin))
}

export function formatDecorationAttribution(counts: DecorationCount[], limit = 6): string | null {
  if (counts.length === 0) return null
  const total = counts.reduce((sum, count) => sum + count.decorations, 0)
  const ranked = counts.slice(0, limit).map(({ plugin, decorations }) => `${plugin}:${decorations}`)
  return `decorations=${total} decoBy=${ranked.join(',')}`
}

export type { DecorationCount }

/** Exposed for the swap path: attribute and format in one step. */
export function describeStateDecorations(state: EditorState | null | undefined): string | null {
  return formatDecorationAttribution(attributeDecorations(state))
}

/** Kept separate so plugin-level timings can be surfaced if the counts alone are
 * inconclusive — a plugin returning a cached set is fast to ask but may still be
 * expensive to have built. */
export function formatDecorationTimings(counts: DecorationCount[], limit = 4): string | null {
  const timed = counts.filter((count) => count.ms >= 0.5).slice(0, limit)
  if (timed.length === 0) return null
  return `decoAsk=${timed.map(({ plugin, ms }) => `${plugin}:${ms.toFixed(1)}ms`).join(',')}`
}
