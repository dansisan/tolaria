import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorState } from 'prosemirror-state'
import {
  attributeDecorations,
  formatDecorationAttribution,
  formatDecorationTimings,
} from './editorDecorationAttribution'
import { setExpensiveCallLogging } from '../utils/expensiveCallLog'

function fakeState(plugins: unknown[]): EditorState {
  return { plugins } as unknown as EditorState
}

function decoratingPlugin(key: string, decorationCount: number) {
  return {
    key,
    props: {
      decorations: () => ({ find: () => Array.from({ length: decorationCount }, (_, i) => i) }),
    },
  }
}

describe('editorDecorationAttribution', () => {
  beforeEach(() => {
    setExpensiveCallLogging(true)
  })

  afterEach(() => {
    setExpensiveCallLogging(null)
    vi.restoreAllMocks()
  })

  it('returns nothing while diagnostics are off', () => {
    setExpensiveCallLogging(false)

    expect(attributeDecorations(fakeState([decoratingPlugin('inlineTags$', 5)]))).toEqual([])
  })

  it('returns nothing for a missing state', () => {
    expect(attributeDecorations(null)).toEqual([])
  })

  it('ranks plugins by decoration count and strips the key marker', () => {
    const counts = attributeDecorations(fakeState([
      decoratingPlugin('inlineTags$', 3),
      decoratingPlugin('codeBlockLineNumbers$1', 796),
    ]))

    expect(counts.map((count) => count.plugin)).toEqual(['codeBlockLineNumbers', 'inlineTags'])
    expect(counts[0].decorations).toBe(796)
  })

  it('skips plugins with no decorations prop, none produced, or that throw', () => {
    const counts = attributeDecorations(fakeState([
      { key: 'noProps$' },
      decoratingPlugin('empty$', 0),
      { key: 'broken$', props: { decorations: () => { throw new Error('needs a live view') } } },
      decoratingPlugin('real$', 2),
    ]))

    expect(counts).toHaveLength(1)
    expect(counts[0]).toMatchObject({ plugin: 'real', decorations: 2 })
  })

  it('names unkeyed plugins by position', () => {
    const counts = attributeDecorations(fakeState([
      { props: { decorations: () => ({ find: () => [1] }) } },
    ]))

    expect(counts[0].plugin).toBe('plugin0')
  })

  it('formats a total plus the biggest contributors', () => {
    const formatted = formatDecorationAttribution([
      { plugin: 'codeBlockLineNumbers', decorations: 796, ms: 0.2 },
      { plugin: 'inlineTags', decorations: 4, ms: 0.1 },
    ])

    expect(formatted).toBe('decorations=800 decoBy=codeBlockLineNumbers:796,inlineTags:4')
  })

  it('returns null formatting when no plugin decorated', () => {
    expect(formatDecorationAttribution([])).toBeNull()
    expect(formatDecorationTimings([])).toBeNull()
  })

  it('reports only plugins slow enough to ask, ignoring sub-0.5ms noise', () => {
    const timings = formatDecorationTimings([
      { plugin: 'slow', decorations: 10, ms: 4.2 },
      { plugin: 'fast', decorations: 10, ms: 0.1 },
    ])

    expect(timings).toBe('decoAsk=slow:4.2ms')
  })
})
