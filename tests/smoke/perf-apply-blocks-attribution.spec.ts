/**
 * PERMANENT on-demand diagnostic — attributes the cost of installing a document
 * into the editor. Deliberately NOT tagged @smoke, so it needs the regression
 * config (the smoke config filters on that tag):
 *
 *   npx playwright test --config playwright.config.ts \
 *     tests/smoke/perf-apply-blocks-attribution.spec.ts --retries=0
 *
 * Reproduces the dense-lines worst case (thousands of short single-spaced lines
 * collapsing into a few blocks, so every newline becomes its own hardBreak node)
 * and prints the breakdown from the app's own `editor.applyBlocks` line:
 *
 *   install=  — how long installing the document took
 *   nodes=    — document nodes, which is what the cost tracks
 *   types=    — node histogram, so the shape is visible (hardBreak-heavy notes are
 *               the pathological case)
 *
 * The CDP-based tests below are the ones that actually localise a regression: they
 * split script/style/layout and bisect the stylesheets. Prefer them over adding more
 * application-level instrumentation.
 *
 * A caution learned the hard way: toggle stylesheets with `sheet.disabled`, never by
 * rewriting rules with deleteRule/insertRule. Mutating a sheet's rules perturbs
 * Chrome's rule-set state enough to corrupt the very measurement being taken — a
 * per-rule bisect built that way attributed 330ms of style recalculation to a single
 * animation-reset rule that, tested by injection into a separate sheet, costs ~4ms.
 * For per-selector attribution use Chrome's Selector Stats tracing instead.
 *
 * The assertions cover the shape (node counts, which are engine-independent and
 * deterministic); the timings are printed, not asserted, because Chromium here is
 * not WKWebView in the shipped app. Compare runs against each other.
 */
import { test, expect, type Page } from '@playwright/test'
import { createPerfVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

interface ApplyBlocksSample {
  raw: string
  route: string
  blocks: number
  took: number
  install: number
}

function field(line: string, name: string): string | null {
  const match = line.match(new RegExp(`${name}=([^\\s]+)`))
  return match ? match[1] : null
}

function numberField(line: string, name: string): number {
  const value = field(line, name)
  return value === null ? 0 : Number(value.replace('ms', ''))
}

function parseApplyBlocks(line: string): ApplyBlocksSample {
  return {
    raw: line,
    route: field(line, 'route') ?? 'unknown',
    blocks: numberField(line, 'blocks'),
    took: numberField(line, 'took'),
    // The log line reports the duration as `took=`; `install=` only exists when extra
    // phase instrumentation is present, so fall back.
    install: numberField(line, 'install') || numberField(line, 'took'),
  }
}

/** The rendered shape of the open note, read from the DOM rather than from the app's
 * log line: this is the ground truth for what the browser has to style and lay out. */
async function editorDomShape(page: Page): Promise<{
  elements: number
  brs: number
  paragraphs: number
  scrollHeight: number
}> {
  return page.evaluate(() => {
    const editor = document.querySelector('.bn-editor')
    return {
      elements: editor?.querySelectorAll('*').length ?? 0,
      brs: editor?.querySelectorAll('br').length ?? 0,
      paragraphs: editor?.querySelectorAll('p').length ?? 0,
      scrollHeight: (editor as HTMLElement | null)?.scrollHeight ?? 0,
    }
  })
}

async function openNote(page: Page, title: string, marker: string): Promise<void> {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toContainText(`UNIQUE-MARKER: ${marker}`, { timeout: 30_000 })
}



test('diagnostic: attribute editor document-install cost', async ({ page }) => {
  test.setTimeout(300_000)
  const applyLines: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[perf] expensive editor.applyBlocks ')) applyLines.push(text)
  })

  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })

    // Small control first so the dense-lines sample is a clean cold open.
    await openNote(page, 'Small Control', 'SMALL-CONTROL')
    applyLines.length = 0

    // ~9k short single-spaced lines: cost tracks line count, not bytes.
    await openNote(page, 'Dense Lines', 'DENSE-LINES')
    await page.waitForTimeout(1_000)
    const giant = applyLines.map(parseApplyBlocks).sort((a, b) => b.install - a.install)[0]
    const denseShape = await editorDomShape(page)

    applyLines.length = 0
    await openNote(page, 'Big Note A', 'BIG-NOTE-A')
    await page.waitForTimeout(1_000)
    const paragraphs = applyLines.map(parseApplyBlocks).sort((a, b) => b.install - a.install)[0]
    const paragraphShape = await editorDomShape(page)

    console.log('--- document install attribution ---')
    console.log(`dense-lines : ${giant.raw}`)
    console.log(`big-note-a  : ${paragraphs.raw}`)

    console.log('--- summary ---')
    console.log(`dense-lines install=${giant.install}ms   dom=${JSON.stringify(denseShape)}`)
    console.log(`big-note-a  install=${paragraphs.install}ms   dom=${JSON.stringify(paragraphShape)}`)

    // Shape assertions: deterministic and engine-independent, unlike the timings.
    // Thousands of <br> inside a handful of <p> is the pathological shape — one huge
    // inline formatting context, and thousands of siblings for :has() rules to match.
    expect(denseShape.brs).toBeGreaterThan(5_000)
    expect(denseShape.paragraphs).toBeLessThan(20)
    expect(denseShape.scrollHeight).toBeGreaterThan(100_000)
    // Same byte size, an order of magnitude fewer elements.
    expect(paragraphShape.brs).toBeLessThan(denseShape.brs / 10)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * Separates building the incoming document from tearing down the outgoing one.
 *
 * A live swap both builds the incoming document and tears down the outgoing one. If
 * teardown is a real term, the cost of a switch depends on the direction of travel:
 * arriving at a tiny note *from* an 18k-node one should be expensive despite the
 * incoming document being trivial.
 */
test('diagnostic: build cost versus teardown cost by direction', async ({ page }) => {
  test.setTimeout(300_000)
  const applyLines: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[perf] expensive editor.applyBlocks ')) applyLines.push(text)
  })

  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })

    const sample = async (title: string, marker: string): Promise<ApplyBlocksSample> => {
      applyLines.length = 0
      await openNote(page, title, marker)
      await page.waitForTimeout(1_000)
      return applyLines.map(parseApplyBlocks).sort((a, b) => b.install - a.install)[0]
    }

    // Prime both notes so later samples are revisits with equal cache state.
    await sample('Small Control', 'SMALL-CONTROL')
    await sample('Dense Lines', 'DENSE-LINES')
    await sample('Small Control', 'SMALL-CONTROL')

    const smallToDense = await sample('Dense Lines', 'DENSE-LINES')
    const denseToSmall = await sample('Small Control', 'SMALL-CONTROL')
    await sample('Dense Lines', 'DENSE-LINES')
    const denseToBig = await sample('Big Note A', 'BIG-NOTE-A')

    const row = (label: string, s: ApplyBlocksSample) => `${label.padEnd(16)} `
      + `route=${s.route.padEnd(14)} install=${String(s.install).padStart(7)}ms `
      + `blocks=${String(s.blocks).padStart(4)} took=${s.took}ms`

    console.log('--- build versus teardown (raw lines show the phase split) ---')
    for (const [label, sample] of [
      ['small -> dense', smallToDense],
      ['dense -> small', denseToSmall],
      ['dense -> bigA', denseToBig],
    ] as const) {
      console.log(`${label}: ${sample.raw}`)
    }
    console.log(row('small -> dense', smallToDense))
    console.log(row('dense -> small', denseToSmall))
    console.log(row('dense -> bigA', denseToBig))
    console.log(`teardown share: arriving at a ${denseToSmall.nodes}-node document from an `
      + `18k-node one cost ${denseToSmall.install}ms of install`)

    // Both directions must produce a sample; the numbers are printed for comparison.
    expect(smallToDense.install).toBeGreaterThan(0)
    expect(denseToSmall.install).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * The traversal fix: arrowing through the note list must not install every note it
 * passes over. Counts document installs across a rapid multi-note traversal.
 */
test('diagnostic: arrow traversal installs only the notes it lands on', async ({ page }) => {
  test.setTimeout(300_000)
  const applyLines: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[perf] expensive editor.applyBlocks ')) applyLines.push(text)
  })

  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })

    // Land in the list, then traverse with the keyboard only.
    await openNote(page, 'Big Note A', 'BIG-NOTE-A')
    await page.getByTestId('note-list-container').getByText('Big Note A', { exact: true }).click()
    await page.waitForTimeout(1_000)
    applyLines.length = 0

    const PRESSES = 6
    for (let press = 0; press < PRESSES; press += 1) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(40)   // faster than the settle delay
    }
    await page.waitForTimeout(2_000)  // let the settled open complete

    const installs = applyLines.map(parseApplyBlocks)
    const totalInstall = installs.reduce((sum, sample) => sum + sample.install, 0)
    console.log('--- traversal installs ---')
    console.log(`${PRESSES} presses -> ${installs.length} document installs, `
      + `${totalInstall.toFixed(1)}ms of install total`)
    for (const sample of installs) {
      console.log(`  route=${sample.route} install=${sample.install}ms blocks=${sample.blocks}`)
    }

    // Without settling this was one install per press.
    expect(installs.length).toBeLessThan(PRESSES)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})


/**
 * Attributes the swap to actual functions using V8's sampling profiler over CDP,
 * rather than by hypothesis. Prints the highest self-time frames while a dense note
 * is installed, so the bottleneck can be read off directly — including inside
 * BlockNote and ProseMirror, where our own instrumentation cannot reach.
 */
test('diagnostic: profile the document install', async ({ page }) => {
  test.setTimeout(300_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    await openNote(page, 'Small Control', 'SMALL-CONTROL')
    await page.waitForTimeout(500)

    // Deliberately WITHOUT the view-build probe: those probes build several extra
    // 18k-node views and force reflows, which otherwise dominate the profile.
    const client = await page.context().newCDPSession(page)
    await client.send('Profiler.enable')
    await client.send('Profiler.setSamplingInterval', { interval: 100 })
    await client.send('Profiler.start')

    await openNote(page, 'Dense Lines', 'DENSE-LINES')
    await page.waitForTimeout(500)

    const stopped = await client.send('Profiler.stop') as unknown as {
      profile: {
        nodes: Array<{
          id: number
          hitCount?: number
          callFrame: { functionName: string; url: string; lineNumber: number }
        }>
        startTime: number
        endTime: number
        samples?: number[]
      }
    }

    const { nodes, startTime, endTime, samples = [] } = stopped.profile
    const totalSamples = samples.length || nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0)
    const wallMs = (endTime - startTime) / 1000
    const msPerSample = totalSamples > 0 ? wallMs / totalSamples : 0

    const ranked = nodes
      .filter((node) => (node.hitCount ?? 0) > 0)
      .map((node) => ({
        name: node.callFrame.functionName || '(anonymous)',
        where: `${node.callFrame.url.split('/').slice(-1)[0]}:${node.callFrame.lineNumber + 1}`,
        selfMs: (node.hitCount ?? 0) * msPerSample,
      }))
      .sort((a, b) => b.selfMs - a.selfMs)
      .slice(0, 18)

    console.log(`--- profile of installing Dense Lines (${wallMs.toFixed(0)}ms wall, ${totalSamples} samples) ---`)
    for (const frame of ranked) {
      console.log(`${frame.selfMs.toFixed(1).padStart(8)}ms  ${frame.name.padEnd(34)} ${frame.where}`)
    }

    expect(ranked.length).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * Splits the browser-side cost that the CPU profiler lumps into `(program)`.
 *
 * `Performance.getMetrics` exposes cumulative ScriptDuration / RecalcStyleDuration /
 * LayoutDuration counters, so diffing them across a note open says whether the time
 * is script, style recalculation, or layout — the three have completely different
 * fixes. Also counts the real DOM, since "18,000 nodes" refers to ProseMirror
 * document nodes, not DOM elements.
 */
test('diagnostic: script versus style versus layout, and real DOM size', async ({ page }) => {
  test.setTimeout(300_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    const client = await page.context().newCDPSession(page)
    await client.send('Performance.enable')

    const readMetrics = async (): Promise<Record<string, number>> => {
      const result = await client.send('Performance.getMetrics') as unknown as {
        metrics: Array<{ name: string; value: number }>
      }
      return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]))
    }

    const countDom = () => page.evaluate(() => {
      const editor = document.querySelector('.bn-editor')
      if (!editor) return null
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let textNodes = 0
      while (walker.nextNode()) textNodes += 1
      return {
        elements: editor.querySelectorAll('*').length,
        brs: editor.querySelectorAll('br').length,
        textNodes,
        paragraphs: editor.querySelectorAll('p').length,
        scrollHeight: (editor as HTMLElement).scrollHeight,
      }
    })

    for (const [title, marker] of [['Small Control', 'SMALL-CONTROL'], ['Dense Lines', 'DENSE-LINES']] as const) {
      const before = await readMetrics()
      await openNote(page, title, marker)
      await page.waitForTimeout(1_500)
      const after = await readMetrics()
      const dom = await countDom()

      const delta = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000
      const count = (name: string) => (after[name] ?? 0) - (before[name] ?? 0)
      console.log(`--- ${title} ---`)
      console.log(`  script=${delta('ScriptDuration').toFixed(0)}ms `
        + `recalcStyle=${delta('RecalcStyleDuration').toFixed(0)}ms `
        + `layout=${delta('LayoutDuration').toFixed(0)}ms `
        + `task=${delta('TaskDuration').toFixed(0)}ms`)
      // Counts, not durations: a layout per insertion means something reads geometry
      // mid-install, which is quadratic on a growing document. A handful means it does not.
      console.log(`  layouts=${count('LayoutCount')} styleRecalcs=${count('RecalcStyleCount')}`)
      console.log(`  DOM: elements=${dom?.elements} br=${dom?.brs} textNodes=${dom?.textNodes} `
        + `p=${dom?.paragraphs} scrollHeight=${dom?.scrollHeight}px`)
    }

    expect(true).toBe(true)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * Bisects the style-recalculation cost by disabling the application stylesheets and
 * re-opening the same note. Selector matching is the only thing that changes: if
 * recalcStyle collapses, expensive selectors are matching thousands of elements and
 * the stylesheet itself can then be bisected rule by rule.
 */
test('diagnostic: is style recalc driven by our CSS', async ({ page }) => {
  test.setTimeout(300_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    const client = await page.context().newCDPSession(page)
    await client.send('Performance.enable')

    const readMetrics = async (): Promise<Record<string, number>> => {
      const result = await client.send('Performance.getMetrics') as unknown as {
        metrics: Array<{ name: string; value: number }>
      }
      return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]))
    }

    // Clicked through the DOM, not Playwright: with stylesheets disabled the layout
    // collapses and hit-testing hits whatever now overlaps the row.
    const clickRow = async (title: string) => {
      await page.evaluate((wanted) => {
        const list = document.querySelector('[data-testid="note-list-container"]')
        const row = Array.from(list?.querySelectorAll('[data-note-path]') ?? [])
          .find((candidate) => candidate.textContent?.includes(wanted))
        ;(row as HTMLElement | undefined)?.click()
      }, title)
    }

    const sample = async (label: string) => {
      await clickRow('Small Control')
      await page.waitForTimeout(1_200)
      const before = await readMetrics()
      await clickRow('Dense Lines')
      await page.waitForTimeout(2_500)
      const after = await readMetrics()
      const delta = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000
      console.log(`${label.padEnd(18)} script=${delta('ScriptDuration').toFixed(0)}ms `
        + `recalcStyle=${delta('RecalcStyleDuration').toFixed(0)}ms `
        + `layout=${delta('LayoutDuration').toFixed(0)}ms `
        + `task=${delta('TaskDuration').toFixed(0)}ms`)
    }

    await sample('styles on')

    const sheetCount = await page.evaluate(() => {
      let disabled = 0
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          sheet.disabled = true
          disabled += 1
        } catch {
          // Cross-origin sheets cannot be toggled; ignore.
        }
      }
      return disabled
    })
    console.log(`disabled ${sheetCount} stylesheets`)

    await sample('styles off')
    expect(sheetCount).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * Leave-one-out bisect over the stylesheets: with all but one enabled, re-open the
 * dense note and record style recalculation. The sheet whose absence drops
 * recalcStyle the most is the one whose selectors are matching thousands of elements.
 */
test('diagnostic: bisect stylesheets by style-recalc cost', async ({ page }) => {
  test.setTimeout(600_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    const client = await page.context().newCDPSession(page)
    await client.send('Performance.enable')

    const readMetrics = async (): Promise<Record<string, number>> => {
      const result = await client.send('Performance.getMetrics') as unknown as {
        metrics: Array<{ name: string; value: number }>
      }
      return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]))
    }

    const clickRow = async (title: string) => {
      await page.evaluate((wanted) => {
        const list = document.querySelector('[data-testid="note-list-container"]')
        const row = Array.from(list?.querySelectorAll('[data-note-path]') ?? [])
          .find((candidate) => candidate.textContent?.includes(wanted))
        ;(row as HTMLElement | undefined)?.click()
      }, title)
    }

    const setSheets = (skipIndex: number) => page.evaluate((skip) => {
      const sheets = Array.from(document.styleSheets)
      sheets.forEach((sheet, index) => {
        try {
          sheet.disabled = index === skip
        } catch { /* cross-origin */ }
      })
      const target = sheets[skip]
      const rules = (() => {
        try {
          return target?.cssRules?.length ?? -1
        } catch {
          return -1
        }
      })()
      return { href: target?.href ?? '(inline)', rules }
    }, skipIndex)

    const sample = async (): Promise<{ recalc: number; layout: number; task: number }> => {
      await clickRow('Small Control')
      await page.waitForTimeout(1_000)
      const before = await readMetrics()
      await clickRow('Dense Lines')
      await page.waitForTimeout(2_200)
      const after = await readMetrics()
      const delta = (name: string) => ((after[name] ?? 0) - (before[name] ?? 0)) * 1000
      return {
        recalc: delta('RecalcStyleDuration'),
        layout: delta('LayoutDuration'),
        task: delta('TaskDuration'),
      }
    }

    const sheetCount = await page.evaluate(() => document.styleSheets.length)
    console.log(`--- leave-one-out over ${sheetCount} stylesheets ---`)
    const baseline = await sample()
    console.log(`all enabled          recalc=${baseline.recalc.toFixed(0)}ms layout=${baseline.layout.toFixed(0)}ms task=${baseline.task.toFixed(0)}ms`)

    for (let index = 0; index < sheetCount; index += 1) {
      const info = await setSheets(index)
      const result = await sample()
      const saved = baseline.recalc - result.recalc
      const name = info.href === '(inline)' ? '(inline)' : info.href.split('/').slice(-1)[0]
      console.log(`without ${name.slice(0, 28).padEnd(28)} rules=${String(info.rules).padStart(5)} `
        + `recalc=${result.recalc.toFixed(0).padStart(5)}ms savedRecalc=${saved.toFixed(0).padStart(5)}ms `
        + `task=${result.task.toFixed(0)}ms`)
    }

    expect(sheetCount).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/** Dumps the selectors of the stylesheet the bisect implicated, so it can be found
 * in the source. Dev builds inject our CSS inline, so it has no href to identify it. */
test('diagnostic: identify the expensive stylesheet', async ({ page }) => {
  test.setTimeout(300_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })

    const sheets = await page.evaluate(() => Array.from(document.styleSheets).map((sheet, index) => {
      let selectors: string[] = []
      let count = -1
      try {
        const rules = Array.from(sheet.cssRules)
        count = rules.length
        selectors = rules
          .map((rule) => (rule as CSSStyleRule).selectorText ?? `@${rule.constructor.name}`)
          .filter(Boolean)
      } catch { /* cross-origin */ }
      return { index, href: sheet.href, count, selectors }
    }))

    for (const sheet of sheets) {
      if (sheet.count !== 93) continue
      console.log(`--- the 93-rule stylesheet (index ${sheet.index}, href=${sheet.href ?? 'inline'}) ---`)
      sheet.selectors.forEach((selector, position) => {
        console.log(`  ${String(position + 1).padStart(3)}. ${selector}`)
      })
    }

    console.log('--- all sheets ---')
    for (const sheet of sheets) {
      console.log(`  index=${sheet.index} rules=${sheet.count} href=${sheet.href ?? 'inline'} first=${sheet.selectors[0] ?? '?'}`)
    }
    expect(sheets.length).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})



/** Lists every :has() rule on the page with its stylesheet, to find their origin. */
test('diagnostic: inventory of :has rules', async ({ page }) => {
  test.setTimeout(120_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    const inventory = await page.evaluate(() => {
      const found: Array<{ sheet: number; rules: number; selector: string }> = []
      Array.from(document.styleSheets).forEach((sheet, sheetIndex) => {
        let rules: CSSRule[]
        try {
          rules = Array.from(sheet.cssRules)
        } catch {
          return
        }
        for (const rule of rules) {
          const selector = (rule as CSSStyleRule).selectorText
          if (selector?.includes(':has(')) {
            found.push({ sheet: sheetIndex, rules: rules.length, selector })
          }
        }
      })
      return found
    })

    console.log(`--- ${inventory.length} :has() rules ---`)
    for (const entry of inventory) {
      console.log(`sheet=${entry.sheet}(${entry.rules}) ${entry.selector.slice(0, 150)}`)
    }
    expect(inventory.length).toBeGreaterThan(0)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})






