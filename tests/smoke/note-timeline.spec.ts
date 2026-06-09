import { test, expect } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultTauri(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke timeline button opens a chart of the notes over time', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.getByRole('button', { name: 'View notes over time' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Notes over time' })).toBeVisible()

  // The fixture vault has dated notes, so the chart should render bars + a summary.
  await expect(dialog.getByTestId('timeline-bars')).toBeVisible()
  expect(await dialog.getByTestId('timeline-bar').count()).toBeGreaterThan(0)
  await expect(dialog.getByTestId('timeline-summary')).toContainText(/\d+ notes?/)

  // Granularity toggle re-buckets without errors.
  await dialog.getByRole('button', { name: 'Month' }).click()
  await expect(dialog.getByTestId('timeline-bars')).toBeVisible()

  expect(errors).toEqual([])
})
