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
 *   install / stateCreate / viewUpdate  — where the swap time goes
 *   viewBuildCore                       — the same doc built plugin-free and
 *                                         detached, i.e. the irreducible cost
 *   types=                              — node histogram, what is being built
 *   decoBy=                             — decorations per plugin
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
  took: number
  install: number
  viewBuildCore: number | null
  nodes: number
  types: string
  decoBy: string | null
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
  const core = field(line, 'viewBuildCore')
  return {
    raw: line,
    route: field(line, 'route') ?? 'unknown',
    took: numberField(line, 'took'),
    install: numberField(line, 'install'),
    viewBuildCore: core === null ? null : Number(core.replace('ms', '')),
    nodes: numberField(line, 'nodes'),
    types: field(line, 'types') ?? '',
    decoBy: field(line, 'decoBy'),
  }
}

/** Node counts by type, parsed from `types=text:9229,hardBreak:9206,…`. */
function nodeTypeCounts(types: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const pair of types.split(',')) {
    const [name, count] = pair.split(':')
    if (name && count) counts[name] = Number(count)
  }
  return counts
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

    // Set after the vault is open: opening it resets app storage, and the probe
    // re-reads the flag on every call, so no reload is needed.
    const probeFlags = await page.evaluate(() => {
      localStorage.setItem('tolaria:perf-view-build', '1')
      return {
        logging: localStorage.getItem('tolaria:perf-logging'),
        viewBuild: localStorage.getItem('tolaria:perf-view-build'),
      }
    })
    console.log(`probe flags: ${JSON.stringify(probeFlags)} (logging is implicit in dev)`)

    // Small control first so the dense-lines sample is a clean cold open.
    await openNote(page, 'Small Control', 'SMALL-CONTROL')
    applyLines.length = 0

    // ~9k short single-spaced lines: cost tracks line count, not bytes.
    await openNote(page, 'Dense Lines', 'DENSE-LINES')
    await page.waitForTimeout(1_000)
    const giant = applyLines.map(parseApplyBlocks).sort((a, b) => b.install - a.install)[0]

    applyLines.length = 0
    await openNote(page, 'Big Note A', 'BIG-NOTE-A')
    await page.waitForTimeout(1_000)
    const paragraphs = applyLines.map(parseApplyBlocks).sort((a, b) => b.install - a.install)[0]

    console.log('--- document install attribution ---')
    console.log(`dense-lines : ${giant.raw}`)
    console.log(`big-note-a  : ${paragraphs.raw}`)

    const giantTypes = nodeTypeCounts(giant.types)
    console.log('--- summary ---')
    console.log(`dense-lines nodes=${giant.nodes} hardBreak=${giantTypes.hardBreak ?? 0} `
      + `install=${giant.install}ms core=${giant.viewBuildCore}ms decoBy=${giant.decoBy}`)
    console.log(`big-note-a  nodes=${paragraphs.nodes} install=${paragraphs.install}ms `
      + `core=${paragraphs.viewBuildCore}ms`)
    if (giant.viewBuildCore !== null && giant.viewBuildCore > 0) {
      console.log(`core share of install: ${((giant.viewBuildCore / giant.install) * 100).toFixed(1)}%`)
    }

    // Shape assertions: deterministic and engine-independent, unlike the timings.
    expect(giantTypes.hardBreak ?? 0).toBeGreaterThan(5_000)
    expect(giant.nodes).toBeGreaterThan(15_000)
    // The pathology is nodes per block, not note size — both notes are ~100-160KB
    // yet the dense-lines document has an order of magnitude more nodes to build.
    expect(giant.nodes).toBeGreaterThan(paragraphs.nodes * 5)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})

/**
 * Separates building the incoming document from tearing down the outgoing one.
 *
 * `viewBuildCore` builds a fresh detached view, so it never pays for destroying a
 * previous document's descriptors and removing its DOM. A live swap does both. If
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
      + `nodes=${String(s.nodes).padStart(6)} took=${s.took}ms`

    console.log('--- build versus teardown ---')
    console.log(row('small -> dense', smallToDense))
    console.log(row('dense -> small', denseToSmall))
    console.log(row('dense -> bigA', denseToBig))
    console.log(`teardown share: arriving at a ${denseToSmall.nodes}-node document from an `
      + `18k-node one cost ${denseToSmall.install}ms of install`)

    // Both directions must produce a sample; the numbers are printed for comparison.
    expect(smallToDense.nodes).toBeGreaterThan(15_000)
    expect(denseToSmall.nodes).toBeLessThan(100)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})
