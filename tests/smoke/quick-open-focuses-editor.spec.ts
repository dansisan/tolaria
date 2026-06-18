import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { dispatchShortcutEvent } from './testBridge'

let tempVaultDir: string

test.beforeEach(() => {
  tempVaultDir = createFixtureVaultCopy()
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
  tempVaultDir = ''
})

async function openQuickOpen(page: import('@playwright/test').Page): Promise<void> {
  await dispatchShortcutEvent(page, {
    key: 'o',
    code: 'KeyO',
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    altKey: false,
    bubbles: true,
    cancelable: true,
  })
  await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
}

test('selecting a note from quick open lands focus in the editor body @smoke', async ({ page }) => {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)

  await openQuickOpen(page)
  await page.locator('input[placeholder="Search notes..."]').fill('Alpha Project')
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('quick-open-palette')).not.toBeVisible({ timeout: 5_000 })

  // The opened note's editor body should hold keyboard focus so the user can
  // type immediately — not <body> or the note list.
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement
    return Boolean(active?.closest('[contenteditable="true"]'))
  }), { timeout: 5_000 }).toBe(true)
})
