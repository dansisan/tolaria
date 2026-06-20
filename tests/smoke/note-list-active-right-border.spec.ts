import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

test.describe('note list active row right border', () => {
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

  const DIVIDER = 'rgb(233, 233, 231)' // --border / #E9E9E7 (light theme)
  const TRANSPARENT = 'rgba(0, 0, 0, 0)'

  test('selected row right border is the divider with list focus and transparent with editor focus', async ({ page }) => {
    const noteList = page.locator('[data-testid="note-list-container"]')
    await noteList.getByText('Alpha Project', { exact: true }).click()
    const row = page.locator('[role="option"][aria-selected="true"]').first()

    // List focused: the open note keeps the same right divider as every other row.
    await noteList.focus()
    await expect(row).toHaveCSS('border-right-color', DIVIDER)
    await page.screenshot({ path: '/tmp/right-border-list-focused.png' })

    // Move focus into the editor: the open note's right border goes transparent
    // so the row reads as connected to the editor.
    const block = page.locator('.bn-block-content').first()
    await block.click()
    await block.evaluate((element) => {
      const editable = element.closest('[contenteditable="true"]')
      if (editable instanceof HTMLElement) editable.focus()
    })
    await expect(row).toHaveCSS('border-right-color', TRANSPARENT)

    // A non-selected row keeps its divider even while the editor is focused.
    const otherRow = page.locator('[role="option"]:not([aria-selected="true"])').first()
    await expect(otherRow).toHaveCSS('border-right-color', DIVIDER)
    await page.screenshot({ path: '/tmp/right-border-editor-focused.png' })
  })
})
