import { trackEvent } from '../lib/telemetry'

const LINK_SELECTOR = '.bn-inline-content a[href]'

function linkAtCaret(selection: Selection | null, container: HTMLElement): HTMLAnchorElement | null {
  if (!selection || !selection.isCollapsed) return null
  const anchor = selection.anchorNode
  const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
  const link = element?.closest<HTMLAnchorElement>(LINK_SELECTOR) ?? null
  return link && container.contains(link) ? link : null
}

/** Copy event with the caret inside a link and nothing selected: copy the link's URL. */
export function copyLinkAtCaret(event: React.ClipboardEvent<HTMLElement>): boolean {
  const link = linkAtCaret(window.getSelection(), event.currentTarget)
  const url = link?.getAttribute('href')
  if (!url) return false

  event.clipboardData.setData('text/plain', url)
  event.preventDefault()
  trackEvent('link_url_copied', { source: 'caret' })
  return true
}
