/**
 * Durable blank-line separators.
 *
 * One blank line between paragraphs is a normal paragraph break; two or more
 * blank lines are an intentional separator the user typed (double Enter in the
 * editor, or two blank lines in an external text editor). BlockNote's markdown
 * import/export is lossy on both: remark collapses blank-line runs on parse and
 * `blocksToMarkdownLossy` drops empty paragraphs on save. These helpers carry
 * the separator through both directions with a sentinel token, so the file on
 * disk keeps a real double blank line and the editor keeps an empty paragraph.
 *
 * Load:  preProcessBlankLineSeparators (2+ blank lines → token paragraph)
 *        → BlockNote parse → injectBlankLineSeparatorBlocks (token → empty paragraph)
 * Save:  markBlankSeparatorBlocksForSerialization (empty paragraph → token paragraph)
 *        → BlockNote serialize + compactMarkdown
 *        → restoreBlankLineSeparators (token line → double blank line)
 */

const BLANK_SEPARATOR_TOKEN = '@@TOLARIA-BLANK-SEPARATOR@@'
const FENCE_RE = /^\s*(```|~~~)/

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isParagraph(block: unknown): block is UnknownRecord {
  return isRecord(block) && block.type === 'paragraph'
}

function hasChildren(block: UnknownRecord): boolean {
  return Array.isArray(block.children) && block.children.length > 0
}

function isBlankLine(line: string): boolean {
  return line.trim() === ''
}

/** True when the held-back blank run should become a separator token. */
function shouldEmitSeparator(options: {
  blankCount: number
  hasPrecedingContent: boolean
  nextLine: string
}): boolean {
  if (options.blankCount < 2) return false
  if (!options.hasPrecedingContent) return false
  // An indented follow-up line is a list/code continuation — leave it alone.
  return !/^[ \t]/.test(options.nextLine)
}

/** Replace runs of 2+ blank lines (outside fences) with a sentinel paragraph. */
export function preProcessBlankLineSeparators({ markdown }: { markdown: string }): string {
  const result: string[] = []
  const state = { inFence: false, blankCount: 0, hasContent: false }

  const flushBlanks = (nextLine: string) => {
    if (shouldEmitSeparator({
      blankCount: state.blankCount,
      hasPrecedingContent: state.hasContent,
      nextLine,
    })) {
      result.push('', BLANK_SEPARATOR_TOKEN, '')
    } else {
      for (let i = 0; i < state.blankCount; i++) result.push('')
    }
    state.blankCount = 0
  }

  for (const line of markdown.split('\n')) {
    if (state.inFence) {
      result.push(line)
      if (FENCE_RE.test(line)) state.inFence = false
      continue
    }
    if (isBlankLine(line)) {
      state.blankCount += 1
      continue
    }
    flushBlanks(line)
    result.push(line)
    state.hasContent = true
    if (FENCE_RE.test(line)) state.inFence = true
  }
  for (let i = 0; i < state.blankCount; i++) result.push('')

  return result.join('\n')
}

function isSeparatorTokenParagraph(block: unknown): boolean {
  if (!isParagraph(block) || hasChildren(block)) return false
  const content = block.content
  if (!Array.isArray(content) || content.length !== 1) return false
  const item = content[0]
  return isRecord(item)
    && item.type === 'text'
    && typeof item.text === 'string'
    && item.text.trim() === BLANK_SEPARATOR_TOKEN
}

/** After parsing, turn sentinel paragraphs back into empty paragraphs. */
export function injectBlankLineSeparatorBlocks(blocks: unknown[]): unknown[] {
  return blocks.map((block) => (
    isSeparatorTokenParagraph(block) ? { ...(block as UnknownRecord), content: [] } : block
  ))
}

function isEmptySeparatorParagraph(block: unknown): boolean {
  return isParagraph(block)
    && !hasChildren(block)
    && Array.isArray(block.content)
    && block.content.length === 0
}

/** Before serializing, give top-level empty paragraphs a sentinel so
 *  `blocksToMarkdownLossy` cannot drop them. */
export function markBlankSeparatorBlocksForSerialization(blocks: unknown[]): unknown[] {
  return blocks.map((block) => (
    isEmptySeparatorParagraph(block)
      ? {
        ...(block as UnknownRecord),
        content: [{ type: 'text', text: BLANK_SEPARATOR_TOKEN, styles: {} }],
      }
      : block
  ))
}

function capBlankRuns(lines: string[]): string[] {
  const result: string[] = []
  let blankRun = 0
  for (const line of lines) {
    blankRun = isBlankLine(line) ? blankRun + 1 : 0
    if (blankRun <= 2) result.push(line)
  }
  // Leading/trailing separators never persisted before tokens existed; keep
  // the file shape stable by trimming them.
  while (result.length > 0 && isBlankLine(result[0])) result.shift()
  while (result.length > 0 && isBlankLine(result[result.length - 1])) result.pop()
  return result
}

/** After compactMarkdown, drop sentinel lines so each separator becomes
 *  exactly one extra blank line (two blank lines total) in the saved file. */
export function restoreBlankLineSeparators(markdown: string): string {
  if (!markdown.includes(BLANK_SEPARATOR_TOKEN)) return markdown

  const lines = markdown.split('\n').filter((line) => line.trim() !== BLANK_SEPARATOR_TOKEN)
  const capped = capBlankRuns(lines)
  return capped.length > 0 ? `${capped.join('\n')}\n` : ''
}
