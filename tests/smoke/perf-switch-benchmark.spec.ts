/**
 * PERMANENT on-demand benchmark — large-note performance across four
 * conditions. NOT in the curated smoke lane; run manually when iterating:
 *
 *   npx playwright test --config playwright.smoke.config.ts \
 *     tests/smoke/perf-switch-benchmark.spec.ts --retries=0
 *
 * Conditions:
 *   A first-visit    — opening each note cold (parse + caches empty)
 *   B revisit-clean  — switching back through notes never edited
 *   C typing         — keystroke→next-frame latency while editing
 *   D revisit-edited — switching through notes after editing them
 *
 * What a switch sample times: the app's own `[perf] noteOpen` trace, from
 * the note-list click (`replace-active-tab`) to the editor signalling the
 * swapped content (`editorSwapped`), with contentLoad (disk/cache) and
 * editorSwap (schedule + apply + render contention) phases.
 *
 * Writes benchmarks/switch-latency.json. Dev-harness numbers — compare
 * runs against each other, never against native feel.
 */
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createPerfVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

const CLEAN_REVISIT_ROUNDS = 2
const EDITED_REVISIT_ROUNDS = 3
const ROTATION: Array<[string, string]> = [
  ['Big Note A', 'BIG-NOTE-A'],
  ['Big Note B', 'BIG-NOTE-B'],
  ['Giant Block', 'GIANT-BLOCK'],
  ['Big Note C', 'BIG-NOTE-C'],
  ['Small Control', 'SMALL-CONTROL'],
]

interface NoteOpenSample {
  path: string
  total: number
  contentLoad: number | null
  editorSwap: number | null
}

interface KeystrokeCapture { t0: number; raf1: number }

declare global {
  interface Window { __benchKeys?: KeystrokeCapture[] }
}

function parsePerfLine(line: string): NoteOpenSample | null {
  const match = line.match(/noteOpen path=(\S+).*total=([\d.]+)ms.*contentLoad=([\d.]+|n\/a).*editorSwap=([\d.]+|n\/a)/)
  if (!match) return null
  const num = (value: string) => (value === 'n/a' ? null : Number(value))
  return { path: match[1], total: Number(match[2]), contentLoad: num(match[3]), editorSwap: num(match[4]) }
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

function summarizeSwitches(samples: NoteOpenSample[]) {
  const totals = samples.map((sample) => sample.total)
  const loads = samples.flatMap((sample) => (sample.contentLoad === null ? [] : [sample.contentLoad]))
  const swaps = samples.flatMap((sample) => (sample.editorSwap === null ? [] : [sample.editorSwap]))
  return {
    n: samples.length,
    totalP50: quantile(totals, 0.5),
    totalP90: quantile(totals, 0.9),
    contentLoadP50: quantile(loads, 0.5),
    editorSwapP50: quantile(swaps, 0.5),
  }
}

function formatSwitchRow(label: string, stats: ReturnType<typeof summarizeSwitches>): string {
  return `${label}: p50=${stats.totalP50.toFixed(0)} p90=${stats.totalP90.toFixed(0)} (load=${stats.contentLoadP50.toFixed(0)}, swap=${stats.editorSwapP50.toFixed(0)}, n=${stats.n})`
}

async function openNote(page: Page, title: string, marker: string): Promise<void> {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toContainText(`UNIQUE-MARKER: ${marker}`, { timeout: 30_000 })
}

async function editAtTop(page: Page, text: string): Promise<void> {
  await page.locator('.bn-editor p').first().click({ position: { x: 4, y: 8 } })
  await page.keyboard.type(text, { delay: 40 })
}

async function installKeystrokeProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__benchKeys = []
    document.addEventListener('keydown', () => {
      const record: KeystrokeCapture = { t0: performance.now(), raf1: 0 }
      window.__benchKeys?.push(record)
      requestAnimationFrame(() => { record.raf1 = performance.now() })
    }, { capture: true })
  })
}

async function collectKeystrokeLatencies(page: Page): Promise<number[]> {
  return page.evaluate(() => (window.__benchKeys ?? [])
    .filter((record) => record.raf1 > 0)
    .map((record) => record.raf1 - record.t0))
}

test('@smoke benchmark: large-note switch and typing latency', async ({ page }) => {
  test.setTimeout(600_000)
  const perfLines: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[perf] noteOpen') && text.includes('replace-active-tab')) perfLines.push(text)
  })

  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    await installKeystrokeProbe(page)

    // A: first visits (cold caches)
    for (const [title, marker] of ROTATION) {
      await openNote(page, title, marker)
      await page.waitForTimeout(250)
    }
    const firstVisitEnd = perfLines.length

    // B: clean revisits — no note has ever been edited
    for (let round = 0; round < CLEAN_REVISIT_ROUNDS; round += 1) {
      for (const [title, marker] of ROTATION) {
        await openNote(page, title, marker)
        await page.waitForTimeout(250)
      }
    }
    const cleanRevisitEnd = perfLines.length

    // C+D: edit each visit, keep switching (typing probe records C)
    for (let round = 0; round < EDITED_REVISIT_ROUNDS; round += 1) {
      for (const [title, marker] of ROTATION) {
        await openNote(page, title, marker)
        await editAtTop(page, `r${round} edit `)
        await page.waitForTimeout(250)
      }
    }

    const editedRevisitEnd = perfLines.length

    // E: rapid succession — burst through the rotation without settling,
    // measuring burst start -> final note's content visible.
    const burstTimes: number[] = []
    for (let round = 0; round < 3; round += 1) {
      const start = Date.now()
      for (const [title] of ROTATION) {
        await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
        await page.waitForTimeout(60)
      }
      const [, lastMarker] = ROTATION[ROTATION.length - 1]
      await expect(page.locator('.bn-editor')).toContainText(`UNIQUE-MARKER: ${lastMarker}`, { timeout: 30_000 })
      burstTimes.push(Date.now() - start)
      await page.waitForTimeout(400)
    }

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const heapMb = (metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0) / (1024 * 1024)

    const samples = perfLines.map(parsePerfLine).filter((sample): sample is NoteOpenSample => sample !== null)
    const firstVisits = samples.slice(0, firstVisitEnd)
    const cleanRevisits = samples.slice(firstVisitEnd, cleanRevisitEnd)
    const editedSamples = samples.slice(cleanRevisitEnd, editedRevisitEnd)
    // The first edited-round visit to each note is still a clean revisit
    // (nothing edited yet when it opens); everything after is post-edit.
    const editedRevisits = editedSamples.slice(ROTATION.length)
    const keystrokes = await collectKeystrokeLatencies(page)

    const report = {
      generatedAt: new Date().toISOString(),
      note: 'Browser dev harness; dev-build React inflates absolutes. Compare runs, not absolutes.',
      conditions: {
        'A first-visit': summarizeSwitches(firstVisits),
        'B revisit-clean': summarizeSwitches(cleanRevisits),
        'C typing keydown->frame ms': {
          n: keystrokes.length,
          p50: quantile(keystrokes, 0.5),
          p95: quantile(keystrokes, 0.95),
          max: quantile(keystrokes, 1),
        },
        'D revisit-edited': summarizeSwitches(editedRevisits),
        'E rapid-burst-to-settle ms': { runs: burstTimes, p50: quantile(burstTimes, 0.5) },
        jsHeapUsedMb: Number(heapMb.toFixed(1)),
      },
      byNoteEdited: Object.fromEntries(ROTATION.map(([title]) => {
        const slug = title.toLowerCase().replace(/ /g, '-')
        return [title, summarizeSwitches(editedRevisits.filter((sample) => sample.path.includes(slug)))]
      })),
    }
    fs.mkdirSync('benchmarks', { recursive: true })
    fs.writeFileSync(path.join('benchmarks', 'switch-latency.json'), JSON.stringify(report, null, 2))

    console.log('\n=== large-note benchmark (ms) ===')
    console.log(formatSwitchRow('A first-visit   ', report.conditions['A first-visit']))
    console.log(formatSwitchRow('B revisit-clean ', report.conditions['B revisit-clean']))
    const typing = report.conditions['C typing keydown->frame ms']
    console.log(`C typing         : p50=${typing.p50.toFixed(1)} p95=${typing.p95.toFixed(1)} max=${typing.max.toFixed(1)} (n=${typing.n})`)
    console.log(formatSwitchRow('D revisit-edited', report.conditions['D revisit-edited']))
    console.log(`E rapid-burst     : settle p50=${quantile(burstTimes, 0.5).toFixed(0)}ms runs=[${burstTimes.map((t) => t.toFixed(0)).join(', ')}]`)
    console.log(`JS heap           : ${heapMb.toFixed(1)}MB`)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})
