import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FRIENDLY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const pad = (n: number) => String(n).padStart(2, '0')

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultTauri(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke New Note for Date backdates created/dayCreated and keeps modified at today', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // Open the dialog through the registered command.
  await triggerMenuCommand(page, 'file-new-note-for-date')

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('New Note for Date', { exact: true })).toBeVisible()

  await dialog.getByPlaceholder('Enter note title…').fill('Backdated QA Note')

  // Move to the previous month and pick the 15th so the chosen date differs from today.
  await dialog.locator('.rdp-button_previous').click()
  await dialog.locator('.rdp-day_button', { hasText: /^15$/ }).click()

  await dialog.getByRole('button', { name: 'Create' }).click()

  // The breadcrumb should reflect the newly created note, preserving the typed title.
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('Backdated QA Note', {
    timeout: 5_000,
  })

  // Focus should land inside the note editor after creating.
  await expect.poll(
    () => page.evaluate(() => {
      const active = document.activeElement
      return Boolean(active?.closest('.editor__blocknote-container, .raw-editor-codemirror'))
    }),
    { timeout: 5_000 },
  ).toBe(true)

  const notePath = path.join(tempVaultDir, 'Backdated QA Note.md')
  await expect.poll(() => fs.existsSync(notePath), { timeout: 5_000 }).toBe(true)
  const content = fs.readFileSync(notePath, 'utf8')

  const now = new Date()
  const chosen = new Date(now.getFullYear(), now.getMonth() - 1, 15)
  const chosenPrefix = `${chosen.getFullYear()}-${pad(chosen.getMonth() + 1)}-15`
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  expect(content).toContain('title: Backdated QA Note')
  expect(content).toMatch(new RegExp(`created: "${chosenPrefix} \\d{2}:\\d{2}:\\d{2}"`))
  expect(content).toContain(`dayCreated: ${SHORT_DAYS[chosen.getDay()]}`)
  expect(content).toMatch(new RegExp(`modified: "${today} \\d{2}:\\d{2}:\\d{2}"`))

  // The live inspector reads entry.createdAt — it must show the chosen (backdated)
  // month, not today's. (Month-level so the assertion is timezone-stable.)
  let createdRow = page.getByTestId('readonly-property').filter({ hasText: 'Created' })
  if ((await createdRow.count()) === 0) {
    await triggerMenuCommand(page, 'view-toggle-properties')
    createdRow = page.getByTestId('readonly-property').filter({ hasText: 'Created' })
  }
  await expect(createdRow).toContainText(`${FRIENDLY_MONTHS[chosen.getMonth()]}`)
  await expect(createdRow).toContainText(`${chosen.getFullYear()}`)

  expect(errors).toEqual([])
})
