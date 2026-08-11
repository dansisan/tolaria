import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { dispatchShortcutEvent } from './testBridge'

let tempVaultDir: string

/** The shared fixture vault carries no inline tags, so this spec seeds its own
 *  rather than adding a TAGS sidebar section every other spec would inherit.
 *  Tags go on their own line: both the Rust extractor and the dev-server harness
 *  only collect tags from lines that begin with `#`. */
function writeTaggedNote(vaultDir: string, filename: string, title: string, tags: string[]): void {
  const tagLine = tags.map((tag) => `#${tag}`).join(' ')
  const body = `---\nIs A: Note\nStatus: Active\n---\n\n# ${title}\n\nSeeded for tag browsing.\n\n${tagLine}\n`
  fs.writeFileSync(path.join(vaultDir, 'note', filename), body, 'utf8')
}

test.beforeEach(() => {
  tempVaultDir = createFixtureVaultCopy()
  writeTaggedNote(tempVaultDir, 'roast-chicken.md', 'Roast Chicken', ['recipes', 'dinner'])
  writeTaggedNote(tempVaultDir, 'pasta-bake.md', 'Pasta Bake', ['recipes'])
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openQuickOpen(page: Page): Promise<void> {
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

test('quick open browses vault tags with # and hands off to the tag search', async ({ page }) => {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await openQuickOpen(page)

  const palette = page.getByTestId('quick-open-palette')
  const paletteInput = palette.getByPlaceholder('Search notes...')

  // A bare # lists every tag in the vault, most-used first, with its note count.
  await paletteInput.fill('#')
  await expect(palette.getByText('recipes', { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(palette.getByText('dinner', { exact: true })).toBeVisible()
  await expect(palette.getByTestId('note-search-count-badge').first()).toHaveText('2')

  // Typing narrows the tag list.
  await paletteInput.fill('#reci')
  await expect(palette.getByText('recipes', { exact: true })).toBeVisible()
  await expect(palette.getByText('dinner', { exact: true })).toBeHidden()

  // Enter runs the vault-wide tag search and closes the palette.
  await paletteInput.press('Enter')
  await expect(palette).toBeHidden({ timeout: 5_000 })

  // The note-list search field sits in the list header, outside the row container.
  await expect(page.getByPlaceholder('Search notes...')).toHaveValue('#recipes')

  const noteList = page.getByTestId('note-list-container')
  await expect(noteList.getByText('Roast Chicken', { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText('Pasta Bake', { exact: true })).toBeVisible()
})

test('quick open finds a note by a tag it carries', async ({ page }) => {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await openQuickOpen(page)

  const palette = page.getByTestId('quick-open-palette')
  await palette.getByPlaceholder('Search notes...').fill('dinner')

  // Results are debounced, and every note shows in the pre-debounce recent list —
  // so wait for the untagged note to drop out before trusting what remains.
  await expect(palette.getByText('Pasta Bake', { exact: true })).toBeHidden({ timeout: 5_000 })

  // "Roast Chicken" matches nothing in its title — only its #dinner tag.
  await expect(palette.getByText('Roast Chicken', { exact: true })).toBeVisible()
})
