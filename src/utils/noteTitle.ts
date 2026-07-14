import { parseFrontmatter } from './frontmatter'
import { splitFrontmatter } from './wikilinks'

interface ResolvedContentTitle {
  source: 'h1' | 'frontmatter'
  title: string
}

interface DisplayTitleInput {
  content: string
  filename: string
  frontmatterTitle?: string | null
}

interface DisplayTitleState {
  title: string
  hasH1: boolean
}

/**
 * Notes (no `type:`/`Is A:` frontmatter, or an explicit "Note" type) title by
 * filename alone — H1 and frontmatter `title:` are not title sources for them.
 * Structured Types keep the H1 -> frontmatter title -> filename priority chain.
 */
export function isDefaultNoteType(isA: string | null | undefined): boolean {
  return isA == null || isA === 'Note'
}

function replaceWikilinkAliases(text: string): string {
  return text.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
}

function replacePlainWikilinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1')
}

function replaceMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

function removeInlineMarkdownMarkers(text: string): string {
  return text.replace(/[*_`~]/g, '')
}

function stripMarkdownFormatting(text: string): string {
  return removeInlineMarkdownMarkers(
    replaceMarkdownLinks(
      replacePlainWikilinks(
        replaceWikilinkAliases(text),
      ),
    ),
  )
}

export function filenameStemToTitle(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

export function extractH1TitleFromContent(content: string): string | null {
  const [, body] = splitFrontmatter(content)

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!trimmed.startsWith('# ')) return null
    const title = stripMarkdownFormatting(trimmed.slice(2)).trim()
    return title || null
  }

  return null
}

export function extractFrontmatterTitleFromContent(content: string): string | null {
  const title = parseFrontmatter(content).title
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  return trimmed || null
}

const FRONTMATTER_TITLE_LINE = /^(\s*["']?title["']?\s*:\s*)(.*)$/m

/**
 * When the frontmatter title exactly mirrors the old filename stem (e.g. notes
 * created via the date-picker flow), keep it in sync with a filename rename —
 * a plain filename rename otherwise leaves content untouched, so the stale
 * creation-time title would keep shadowing the new name in the breadcrumb.
 */
export function syncFilenameDerivedFrontmatterTitle(content: string, oldStem: string, newStem: string): string {
  if (oldStem === newStem) return content
  if (extractFrontmatterTitleFromContent(content) !== oldStem) return content

  const [frontmatter, body] = splitFrontmatter(content)
  if (!frontmatter) return content
  const updatedFrontmatter = frontmatter.replace(FRONTMATTER_TITLE_LINE, (_match, prefix: string) => `${prefix}${newStem}`)
  return `${updatedFrontmatter}${body}`
}

function resolveContentTitle(content: string, frontmatterTitle?: string | null): ResolvedContentTitle | null {
  const h1Title = extractH1TitleFromContent(content)
  if (h1Title) {
    return { title: h1Title, source: 'h1' }
  }

  const resolvedFrontmatterTitle = frontmatterTitle?.trim() || extractFrontmatterTitleFromContent(content)
  if (resolvedFrontmatterTitle) {
    return { title: resolvedFrontmatterTitle, source: 'frontmatter' }
  }

  return null
}

export function deriveDisplayTitleState({
  content,
  filename,
  frontmatterTitle,
}: DisplayTitleInput): DisplayTitleState {
  const resolvedTitle = resolveContentTitle(content, frontmatterTitle)
  if (resolvedTitle) {
    return {
      title: resolvedTitle.title,
      hasH1: resolvedTitle.source === 'h1',
    }
  }

  return {
    title: filenameStemToTitle(filename),
    hasH1: false,
  }
}
