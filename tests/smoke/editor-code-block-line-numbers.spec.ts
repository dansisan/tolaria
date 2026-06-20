import { expect, test } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const CODE_NOTE_RELATIVE_PATH = path.join('note', 'code-block-line-numbers.md')
const CODE_NOTE_TITLE = 'Code Block Line Numbers'
const CODE_LINE_NUMBERS_ATTRIBUTE = 'data-code-line-numbers'

function writeLineNumberFixtureNote(tempVaultDir: string) {
  const notePath = path.join(tempVaultDir, CODE_NOTE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, `---
Is A: Note
Status: Active
---

# ${CODE_NOTE_TITLE}

\`\`\`ts
const one = 1
const two = 2
const three = 3
\`\`\`
`)
}

test.describe('Editor code block line numbers', () => {
  let tempVaultDir: string

  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
    writeLineNumberFixtureNote(tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('renders a line-number gutter only when the preference opts in', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    const noteItem = page
      .locator('[data-testid="note-list-container"]')
      .getByText(CODE_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    const codeBlock = page.locator('.bn-block-content[data-content-type="codeBlock"]').first()
    await expect(codeBlock).toBeVisible({ timeout: 10_000 })

    // The widget decorations are always present in the DOM (one per logical
    // line); this proves they render inside the real BlockNote code block.
    const lineNumbers = codeBlock.locator('.editor__code-line-number')
    await expect(lineNumbers).toHaveText(['1', '2', '3'])

    // Hidden until the user opts in, so the default look is unchanged.
    await expect(lineNumbers.first()).toBeHidden()

    // Opting in (what useCodeLineNumbers does for the setting) reveals them via
    // pure CSS — no editor re-render required.
    await page.evaluate((attr) => document.documentElement.setAttribute(attr, 'true'), CODE_LINE_NUMBERS_ATTRIBUTE)
    await expect(lineNumbers.first()).toBeVisible()

    // Every number must sit in the same gutter column inside the block — not
    // just line 1. (Regression: inline <code> padding only indents the first
    // line, leaving later numbers pulled off the left edge and clipped.)
    const blockBox = await codeBlock.boundingBox()
    const count = await lineNumbers.count()
    expect(count).toBe(3)
    const lefts: number[] = []
    for (let i = 0; i < count; i++) {
      const box = await lineNumbers.nth(i).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(blockBox!.x)
      lefts.push(box!.x)
    }
    // All gutter digits share one left-aligned column.
    for (const left of lefts) expect(Math.abs(left - lefts[0])).toBeLessThan(2)
  })
})
