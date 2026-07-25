import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Schema } from 'prosemirror-model'
import {
  formatViewBuild,
  isViewBuildProbeEnabled,
  measureViewBuild,
} from './editorViewBuildProbe'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import { setExpensiveCallLogging } from '../utils/expensiveCallLog'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
})

function docWithParagraphs(count: number) {
  return schema.node('doc', null, Array.from({ length: count }, (_, index) => (
    schema.node('paragraph', null, [schema.text(`line ${index}`)])
  )))
}

describe('editorViewBuildProbe', () => {
  beforeEach(() => {
    localStorage.clear()
    setExpensiveCallLogging(true)
  })

  afterEach(() => {
    setExpensiveCallLogging(null)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stays disabled until the installation opts in', () => {
    expect(isViewBuildProbeEnabled()).toBe(false)

    localStorage.setItem(APP_STORAGE_KEYS.perfViewBuild, '1')
    expect(isViewBuildProbeEnabled()).toBe(true)
  })

  it('stays disabled while perf logging is off, so it cannot double swap work', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfViewBuild, '1')
    setExpensiveCallLogging(false)

    expect(isViewBuildProbeEnabled()).toBe(false)
  })

  it('reports nothing when the probe is off', () => {
    expect(measureViewBuild(docWithParagraphs(3))).toBeNull()
  })

  it('reports nothing for a missing document', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfViewBuild, '1')

    expect(measureViewBuild(null)).toBeNull()
  })

  it('measures build, attach and detach, leaving the document as it found it', () => {
    localStorage.setItem(APP_STORAGE_KEYS.perfViewBuild, '1')
    const childrenBefore = document.body.childElementCount

    const measurement = measureViewBuild(docWithParagraphs(5))

    expect(measurement).not.toBeNull()
    expect(measurement?.coreMs).toBeGreaterThanOrEqual(0)
    expect(measurement?.attachMs).toBeGreaterThanOrEqual(0)
    expect(measurement?.attachLayoutMs).toBeGreaterThanOrEqual(0)
    expect(measurement?.detachMs).toBeGreaterThanOrEqual(0)
    // The probe must not leave its off-screen host behind.
    expect(document.body.childElementCount).toBe(childrenBefore)
  })

  it('formats the measurement, and omits it when unavailable', () => {
    expect(formatViewBuild({ coreMs: 12.34, attachMs: 3.2, attachLayoutMs: 340.5, detachMs: 1.05 }))
      .toBe('viewBuildCore=12.3ms viewAttach=3.2ms viewAttachLayout=340.5ms viewDetach=1.1ms')
    expect(formatViewBuild(null)).toBeNull()
  })
})
