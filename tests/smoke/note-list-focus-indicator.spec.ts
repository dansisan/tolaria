import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

test.describe('note list focus indicator', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
    tempVaultDir = ''
  })

  const ACTIVE_SELECTION_BG = 'rgb(232, 244, 254)' // --state-selected (blue) when the list has focus
  const ACTIVE_SELECTION_BORDER = 'rgb(21, 93, 255)' // --border-focus

  test('selected row left border turns the active blue with list focus and a neutral grey in the editor', async ({ page }) => {
    const noteList = page.locator('[data-testid="note-list-container"]')
    await noteList.getByText('Alpha Project', { exact: true }).click()
    const row = page.locator('[role="option"][aria-selected="true"]').first()

    // Re-focus the list to defeat the open-time auto-focus race, then assert the
    // active (blue) left border + tint and capture it.
    await page.locator('[data-testid="note-list-container"]').focus()
    await expect(row).toHaveCSS('background-color', ACTIVE_SELECTION_BG)
    await expect(row).toHaveCSS('border-left-color', ACTIVE_SELECTION_BORDER)
    await page.screenshot({ path: '/tmp/focus-list-focused.png' })

    // Move focus into the editor body the way a user would: the left border
    // reverts to the note's type color and the editor pane gains its focus accent.
    const block = page.locator('.bn-block-content').first()
    await block.click()
    await block.evaluate((element) => {
      const editable = element.closest('[contenteditable="true"]')
      if (editable instanceof HTMLElement) editable.focus()
    })
    await expect(row).not.toHaveCSS('border-left-color', ACTIVE_SELECTION_BORDER)
    await expect(row).not.toHaveCSS('background-color', ACTIVE_SELECTION_BG)

    const editorShadow = await page
      .locator('.app__editor')
      .evaluate((el) => getComputedStyle(el).boxShadow)
    expect(editorShadow).not.toBe('none')
    await page.screenshot({ path: '/tmp/focus-editor-focused.png' })
  })

  test('Escape from the editor returns focus to the list and restores the active blue border', async ({ page }) => {
    await page.locator('[data-testid="note-list-container"]').getByText('Alpha Project', { exact: true }).click()
    const row = page.locator('[role="option"][aria-selected="true"]').first()

    // Edit the note, then press Escape — the BlockNote editor blurs to <body>,
    // and the app should hand focus back to the list (active blue border).
    await page.locator('.bn-block-content').first().click()
    await expect(row).not.toHaveCSS('border-left-color', ACTIVE_SELECTION_BORDER)

    await page.keyboard.press('Escape')
    await expect(row).toHaveCSS('border-left-color', ACTIVE_SELECTION_BORDER)
    await expect(row).toHaveCSS('background-color', ACTIVE_SELECTION_BG)
  })

  test('arrow navigation from a fresh start focuses the list and shows the active blue border', async ({ page }) => {
    // Nothing clicked yet: focus sits on <body> and arrows drive the list via the
    // global key handler. The list should claim focus so the indicator turns on.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')

    const row = page.locator('[role="option"][aria-selected="true"]').first()
    await expect(row).toHaveCSS('border-left-color', ACTIVE_SELECTION_BORDER)
    await expect(row).toHaveCSS('background-color', ACTIVE_SELECTION_BG)
  })
})
