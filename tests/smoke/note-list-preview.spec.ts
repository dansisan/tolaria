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

const FALLBACK_OPTIONS: Record<number, string> = {
  0: 'None',
  1: '1 line',
  3: '3 lines',
}

/**
 * Center the trigger before opening it: the option popover is fixed-positioned,
 * so a trigger scrolled to the very bottom of the panel opens its list below
 * the viewport where the option cannot be clicked.
 */
async function choosePreviewFallback(page: Page, lines: number) {
  await openSettings(page)
  const select = page.getByTestId('settings-note-list-preview-fallback')
  await select.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await select.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
  await page.getByRole('option', { name: FALLBACK_OPTIONS[lines] }).click()
  await expect(select).toHaveAttribute('data-value', String(lines))
  await page.getByTestId('settings-save').click()
}

/** The clamp is the whole point of the setting, so assert the rendered value. */
function firstSnippetLineClamp(page: Page) {
  return page
    .getByTestId('note-snippet')
    .first()
    .evaluate((element) => getComputedStyle(element).webkitLineClamp)
}

test.describe('Note list preview settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // Dismiss the AI onboarding overlay when it appears; it blocks shortcuts.
    const setUpLater = page.getByRole('button', { name: 'Set up later' })
    await setUpLater.click({ timeout: 4000 }).catch(() => {})
  })

  test('the fallback governs body previews and None removes them', async ({ page }) => {
    await expect.poll(() => firstSnippetLineClamp(page)).toBe('1')
    const oneLineHeight = (await page.getByTestId('note-snippet').first().boundingBox())?.height ?? 0
    expect(oneLineHeight).toBeGreaterThan(0)

    await choosePreviewFallback(page, 3)

    await expect.poll(() => firstSnippetLineClamp(page)).toBe('3')
    const threeLineHeight = (await page.getByTestId('note-snippet').first().boundingBox())?.height ?? 0
    expect(threeLineHeight).toBeGreaterThan(oneLineHeight)

    await choosePreviewFallback(page, 0)

    await expect(page.getByTestId('note-snippet')).toHaveCount(0)
  })

  test('a cleared description field stays cleared when Settings is reopened', async ({ page }) => {
    await openSettings(page)
    const field = page.getByTestId('settings-note-list-description-field')
    await field.scrollIntoViewIfNeeded()
    await expect(field).toHaveValue('description')

    await field.fill('')
    await page.getByTestId('settings-save').click()

    await openSettings(page)
    await expect(page.getByTestId('settings-note-list-description-field')).toHaveValue('')
  })
})
