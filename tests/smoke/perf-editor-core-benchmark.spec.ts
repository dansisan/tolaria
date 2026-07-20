/**
 * PERMANENT on-demand benchmark — isolates BlockNote's own parse/replaceBlocks
 * cost for a 100KB note from Tolaria's caching and tab-swap wrapper. Run
 * manually when iterating on editor-swap performance:
 *
 *   npx playwright test --config playwright.smoke.config.ts \
 *     tests/smoke/perf-editor-core-benchmark.spec.ts --retries=0
 *
 * Answers: is the cost in parsing markdown into blocks, or in replacing the
 * live document with those blocks? Calls editor.tryParseMarkdownToBlocks and
 * editor.replaceBlocks directly via window.__tolariaDebugEditor (see
 * src/hooks/editorDebugBridge.ts) — no repair/selection-reset/requestAnimationFrame
 * wrapper from applyBlocksToEditor, no resolveBlocksForTarget cache layer.
 *
 * Dev-harness numbers — compare runs, not absolutes (see perf-switch-benchmark.spec.ts).
 */
import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { createPerfVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

const RUNS = 5

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
}

test('@smoke benchmark: raw parse+replaceBlocks cost for a 100kb note', async ({ page }) => {
  test.setTimeout(120_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    await page.waitForFunction(() => Boolean(window.__tolariaDebugEditor))

    // Two genuinely different notes — alternating between them means every
    // replaceBlocks call swaps in unrelated content, matching a real note
    // switch (as opposed to replacing a doc with an equivalent copy of itself,
    // which ProseMirror can diff cheaply against the near-identical structure).
    const contentA = fs.readFileSync(path.join(vaultDir, 'big-note-a.md'), 'utf-8')
    const contentB = fs.readFileSync(path.join(vaultDir, 'big-note-b.md'), 'utf-8')
    const parseTimes: number[] = []
    const replaceTimes: number[] = []
    const transactReplaceTimes: number[] = []
    const clonedReplaceTimes: number[] = []

    for (let i = 0; i < RUNS; i += 1) {
      const result = await page.evaluate(async ({ first, second }) => {
        const editor = window.__tolariaDebugEditor
        if (!editor) throw new Error('window.__tolariaDebugEditor not set — dev-only bridge missing')

        const parseStart = performance.now()
        const blocks = await editor.tryParseMarkdownToBlocks(first)
        const parseMs = performance.now() - parseStart

        // Bare replaceBlocks, no transact wrapper — isolates BlockNote's own doc-swap cost.
        const replaceStart = performance.now()
        editor.replaceBlocks(editor.document, blocks)
        const replaceMs = performance.now() - replaceStart

        // Same operation, but wrapped in editor.transact like applyBlocksToEditor
        // does in production — isolates whatever overhead the transact wrapper adds.
        // Swaps to the OTHER note's content, so this is a genuine unrelated-content swap.
        const blocksOther = await editor.tryParseMarkdownToBlocks(second)
        const transactStart = performance.now()
        editor.transact((tr) => {
          tr.setMeta('addToHistory', false)
          editor.replaceBlocks(editor.document, blocksOther)
        })
        const transactReplaceMs = performance.now() - transactStart

        // Same again, but structuredClone the blocks first — matching what
        // editorParsedBlockCache.ts's readParsedNoteBlocks returns on a cache
        // hit in production (a deep clone of the cached parse, not a fresh
        // parse or the object tryParseMarkdownToBlocks handed back).
        const blocksFresh = await editor.tryParseMarkdownToBlocks(first)
        const blocksCloned = structuredClone(blocksFresh)
        const clonedStart = performance.now()
        editor.transact((tr) => {
          tr.setMeta('addToHistory', false)
          editor.replaceBlocks(editor.document, blocksCloned)
        })
        const clonedReplaceMs = performance.now() - clonedStart

        return { parseMs, replaceMs, transactReplaceMs, clonedReplaceMs }
      }, i % 2 === 0 ? { first: contentA, second: contentB } : { first: contentB, second: contentA })
      parseTimes.push(result.parseMs)
      replaceTimes.push(result.replaceMs)
      transactReplaceTimes.push(result.transactReplaceMs)
      clonedReplaceTimes.push(result.clonedReplaceMs)
    }

    console.log('\n=== editor core benchmark (ms), 100KB note ===')
    console.log(`parse             : p50=${quantile(parseTimes, 0.5).toFixed(1)} p90=${quantile(parseTimes, 0.9).toFixed(1)} runs=[${parseTimes.map((t) => t.toFixed(1)).join(', ')}]`)
    console.log(`replace (bare)    : p50=${quantile(replaceTimes, 0.5).toFixed(1)} p90=${quantile(replaceTimes, 0.9).toFixed(1)} runs=[${replaceTimes.map((t) => t.toFixed(1)).join(', ')}]`)
    console.log(`replace (transact): p50=${quantile(transactReplaceTimes, 0.5).toFixed(1)} p90=${quantile(transactReplaceTimes, 0.9).toFixed(1)} runs=[${transactReplaceTimes.map((t) => t.toFixed(1)).join(', ')}]`)
    console.log(`replace (cloned)  : p50=${quantile(clonedReplaceTimes, 0.5).toFixed(1)} p90=${quantile(clonedReplaceTimes, 0.9).toFixed(1)} runs=[${clonedReplaceTimes.map((t) => t.toFixed(1)).join(', ')}]`)

    // Sanity bound, not a tight regression gate — this is a diagnostic tool.
    expect(quantile(parseTimes, 0.5)).toBeLessThan(2_000)
    expect(quantile(replaceTimes, 0.5)).toBeLessThan(2_000)
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})
