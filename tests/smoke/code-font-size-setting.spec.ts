import { test, expect, type Page } from '@playwright/test'
import { openCommandPalette, executeCommand } from './helpers'

async function openSettings(page: Page) {
  await page.locator('body').click()
  await page.keyboard.press('Meta+,')
  const panel = page.locator('[data-testid="settings-panel"]')
  try {
    await panel.waitFor({ timeout: 2000 })
    return panel
  } catch {
    await openCommandPalette(page)
    await executeCommand(page, 'Settings')
    await panel.waitFor({ timeout: 5000 })
  }
  return panel
}

test.describe('Code font size setting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Dismiss the AI onboarding overlay when it appears; it blocks shortcuts.
    const setUpLater = page.getByRole('button', { name: 'Set up later' })
    await setUpLater.click({ timeout: 4000 }).catch(() => {})
  })

  test('defaults to Default and applies a chosen size to the document', async ({ page }) => {
    await openSettings(page)

    const select = page.getByTestId('settings-code-font-size')
    await select.scrollIntoViewIfNeeded()
    await expect(select).toHaveAttribute('data-value', 'default')

    await select.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
    await page.getByRole('option', { name: '13px' }).click()
    await page.getByTestId('settings-save').click()

    await expect.poll(async () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--code-font-size')),
    ).toBe('13px')
  })

  test('restoring Default removes the document override', async ({ page }) => {
    await openSettings(page)

    const select = page.getByTestId('settings-code-font-size')
    await select.scrollIntoViewIfNeeded()
    await select.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
    await page.getByRole('option', { name: '18px' }).click()
    await page.getByTestId('settings-save').click()
    await expect.poll(async () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--code-font-size')),
    ).toBe('18px')

    await openSettings(page)
    await select.scrollIntoViewIfNeeded()
    await select.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
    await page.getByRole('option', { name: 'Default' }).click()
    await page.getByTestId('settings-save').click()

    await expect.poll(async () =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--code-font-size')),
    ).toBe('')
  })
})
