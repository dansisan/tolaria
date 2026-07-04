/**
 * Regression guards for large-note switching: editing a ~100KB note and
 * switching to another must never show or persist the previous note's body
 * (reported 2026-07-04 with notes sorted by size). Uses the persistent
 * fixtures in tests/fixtures/perf-vault.
 */
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createPerfVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
  tempVaultDir = createPerfVaultCopy()
  await openFixtureVault(page, tempVaultDir, { expectedReadyTitle: 'Big Note A' })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string, marker: string): Promise<void> {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toContainText(`UNIQUE-MARKER: ${marker}`, { timeout: 15_000 })
}

async function editorMarkers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const text = (document.querySelector('.bn-editor') as HTMLElement | null)?.innerText ?? ''
    return [...text.matchAll(/UNIQUE-MARKER: ([A-Z-]+)/g)].map((m) => m[1])
  })
}

async function typeAtTopOfBody(page: Page, text: string): Promise<void> {
  await page.locator('.bn-editor p').first().click({ position: { x: 4, y: 8 } })
  await page.keyboard.press('Meta+ArrowLeft')
  await page.keyboard.type(text, { delay: 25 })
}

function fileFor(name: string): string {
  return path.join(tempVaultDir, name)
}

test('@smoke editing a big note then switching shows and persists the right bodies', async ({ page }) => {
  await openNote(page, 'Big Note A', 'BIG-NOTE-A')
  await typeAtTopOfBody(page, 'edit-from-A ')

  // Switch immediately — the buffered edit must follow note A, not leak into B.
  await openNote(page, 'Big Note B', 'BIG-NOTE-B')
  expect(await editorMarkers(page)).toEqual(['BIG-NOTE-B'])

  // A's edit persisted to A's file; B's file untouched by A's content.
  await expect.poll(() => fs.readFileSync(fileFor('big-note-a.md'), 'utf8'), { timeout: 10_000 })
    .toContain('edit-from-A')
  const bContent = fs.readFileSync(fileFor('big-note-b.md'), 'utf8')
  expect(bContent).not.toContain('edit-from-A')
  expect(bContent).not.toContain('BIG-NOTE-A')
})

test('@smoke rapid switching across big notes keeps every body isolated', async ({ page }) => {
  const rotation: Array<[string, string, string]> = [
    ['Big Note A', 'BIG-NOTE-A', 'big-note-a.md'],
    ['Big Note B', 'BIG-NOTE-B', 'big-note-b.md'],
    ['Giant Block', 'GIANT-BLOCK', 'giant-block.md'],
    ['Big Note C', 'BIG-NOTE-C', 'big-note-c.md'],
  ]

  for (let round = 0; round < 2; round += 1) {
    for (const [title, marker] of rotation) {
      await openNote(page, title, marker)
      expect(await editorMarkers(page)).toEqual([marker])
      await typeAtTopOfBody(page, `round${round}-${marker} `)
    }
  }

  for (const [title, marker, filename] of rotation) {
    await openNote(page, title, marker)
    expect(await editorMarkers(page)).toEqual([marker])
    await expect.poll(() => fs.readFileSync(fileFor(filename), 'utf8'), { timeout: 10_000 })
      .toContain(`round1-${marker}`)
    const content = fs.readFileSync(fileFor(filename), 'utf8')
    for (const [, otherMarker] of rotation) {
      if (otherMarker !== marker) expect(content).not.toContain(`UNIQUE-MARKER: ${otherMarker}`)
    }
  }
})
