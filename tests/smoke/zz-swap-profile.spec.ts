import fs from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { createPerfVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

const OUT = '/private/tmp/claude-502/-Users-dansisan-Code-tolaria/577c7406-e5a3-4e24-85d2-c4c40e97f063/scratchpad/swap.cpuprofile'

async function openNote(page: Page, title: string, marker: string): Promise<void> {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toContainText(`UNIQUE-MARKER: ${marker}`, { timeout: 30_000 })
}

test('@smoke profile huge swap composition', async ({ page }) => {
  test.setTimeout(300_000)
  const vaultDir = createPerfVaultCopy()
  try {
    await openFixtureVault(page, vaultDir, { expectedReadyTitle: 'Big Note A' })
    await openNote(page, 'Huge Note X', 'HUGE-NOTE-X')
    await openNote(page, 'Huge Note Y', 'HUGE-NOTE-Y')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.start')
    for (let i = 0; i < 3; i += 1) {
      await openNote(page, 'Huge Note X', 'HUGE-NOTE-X'); await page.waitForTimeout(300)
      await openNote(page, 'Huge Note Y', 'HUGE-NOTE-Y'); await page.waitForTimeout(300)
    }
    const { profile } = await cdp.send('Profiler.stop')
    fs.writeFileSync(OUT, JSON.stringify(profile))
  } finally {
    removeFixtureVaultCopy(vaultDir)
  }
})
