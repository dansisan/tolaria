/**
 * Regression guard for arrow-key note switching: typing into a note, pressing
 * Escape (focus moves to the note list, no flush happens there), then
 * immediately pressing ArrowDown/ArrowUp must never lose the typed content or
 * bleed it into the note the arrow key lands on. Reported 2026-07-10 — unlike
 * the big-note click-switch bleed (see big-note-switch-integrity.spec.ts),
 * this reproduces with small notes and is specific to the arrow-key path,
 * which opens the highlighted note on the next animation frame
 * (useNoteListKeyboard's scheduleOpen) rather than via a click.
 */
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

function allVaultMarkdownFiles(): string[] {
  const results: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (entry.name.endsWith('.md')) results.push(full)
    }
  }
  walk(tempVaultDir)
  return results
}

function filesContainingMarker(marker: string): string[] {
  return allVaultMarkdownFiles().filter((file) => fs.readFileSync(file, 'utf8').includes(marker))
}

async function openNoteByTitle(page: Page, title: string): Promise<void> {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toBeVisible({ timeout: 15_000 })
}

async function typeAtTopOfBody(page: Page, text: string): Promise<void> {
  await page.locator('.bn-editor p').first().click({ position: { x: 4, y: 8 } })
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type(text, { delay: 25 })
}

test('@smoke arrow-key switch right after typing does not lose or bleed the pending edit', async ({ page }) => {
  await openNoteByTitle(page, 'Alpha Project')
  const startTitle = await page.getByTestId('breadcrumb-filename-trigger').innerText()
  const marker = 'ARROW-SWITCH-MARKER'

  await typeAtTopOfBody(page, `${marker} `)

  // Escape only blurs the editor and moves focus to the note list — it does
  // not flush. Immediately follow with ArrowDown, before the rich editor's
  // own 500ms change-debounce would otherwise have flushed it on its own.
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowDown')

  await expect
    .poll(async () => page.getByTestId('breadcrumb-filename-trigger').innerText())
    .not.toBe(startTitle)

  // The note switched to must not show the previous note's just-typed text.
  await expect(page.locator('.bn-editor')).not.toContainText(marker)

  // The marker must land in exactly one file on disk (the note it was typed
  // into) — not zero (lost) and not more than one (bled into another note).
  await expect.poll(() => filesContainingMarker(marker).length, { timeout: 10_000 }).toBe(1)
})

test('@smoke rapid arrow-key switching after typing keeps every note isolated', async ({ page }) => {
  await openNoteByTitle(page, 'Alpha Project')
  for (let i = 0; i < 4; i += 1) {
    const marker = `ARROW-SWITCH-ROUND-${i}`
    await typeAtTopOfBody(page, `${marker} `)
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => filesContainingMarker(marker).length, { timeout: 10_000 }).toBe(1)
  }
})
