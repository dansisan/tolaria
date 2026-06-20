import { test, expect, type Page, type Locator } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

async function expectIconSize(icon: Locator) {
  await expect(icon).toBeVisible({ timeout: 5_000 })
  const box = await icon.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(15)
  expect(box?.width).toBeLessThanOrEqual(17)
  expect(box?.height).toBeGreaterThanOrEqual(15)
  expect(box?.height).toBeLessThanOrEqual(17)
}

async function expectMenuItemIconSize(page: Page, itemName: string) {
  const icon = page.getByRole('menuitem', { name: itemName }).locator('svg').first()
  await expectIconSize(icon)
}

async function selectAlphaProject(page: Page) {
  await expect(async () => {
    const note = page
      .locator('[data-testid="note-list-container"]')
      .getByText('Alpha Project', { exact: true })
      .first()
    await expect(note).toBeVisible({ timeout: 5_000 })
    await note.click({ timeout: 5_000 })
  }).toPass({ timeout: 10_000 })
}

test.describe('Breadcrumb action icon size regression', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('breadcrumb overflow-menu icons render at the pre-regression 16px size', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    await selectAlphaProject(page)

    await expect(page.locator('.breadcrumb-bar')).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: 'More note actions' }).click()
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 5_000 })

    await expectMenuItemIconSize(page, 'Open the raw editor')
    await expectMenuItemIconSize(page, 'Archive this note')
  })
})
