/**
 * Block-separate own-line image references.
 *
 * BlockNote only promotes `![](…)` markdown to an image block when it is
 * block-level — standing alone, separated from surrounding text by a blank
 * line. An image on a line directly adjacent to text (no blank line between)
 * is parsed as inline content of a paragraph and silently dropped, because
 * BlockNote has no inline image node. This loses the image on display and,
 * worse, on the next save.
 *
 * This pre-processing pass finds lines whose entire content is a single image
 * and guarantees a blank line on either side, so BlockNote keeps them. Truly
 * inline images (sharing a line with other text) are left untouched — they
 * need a different mechanism.
 */

const FENCE_RE = /^\s*(```|~~~)/
const IMAGE_LINE_RE = /^!\[[^\]\n]*\]\([^\n]*\)$/

interface MarkdownRequest {
  markdown: string
}

/** True when the whole line (ignoring trailing whitespace) is one image and
 *  is not indented — indentation marks list/blockquote continuations we leave
 *  to BlockNote's own block handling. */
function isStandaloneImageLine(line: string): boolean {
  return IMAGE_LINE_RE.test(line.trimEnd())
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === ''
}

export function separateImageBlockLines({ markdown }: MarkdownRequest): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (inFence) {
      result.push(line)
      if (FENCE_RE.test(line)) inFence = false
      continue
    }
    if (FENCE_RE.test(line)) {
      inFence = true
      result.push(line)
      continue
    }
    if (isStandaloneImageLine(line)) {
      if (!isBlank(result.at(-1))) result.push('')
      result.push(line)
      if (!isBlank(lines[index + 1])) result.push('')
      continue
    }
    result.push(line)
  }

  return result.join('\n')
}
