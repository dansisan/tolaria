import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyLinkAtCaret } from './linkCopyAtCaret'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))

function buildLink() {
  const container = document.createElement('div')
  container.innerHTML = '<div class="bn-inline-content">see <a href="https://example.com/x">the docs</a> later</div>'
  document.body.replaceChildren(container)
  const link = container.querySelector('a')!
  const plain = container.querySelector('.bn-inline-content')!.firstChild!
  return { container, link, plain }
}

function select(node: Node, offset: number, endNode?: Node, endOffset?: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  if (endNode) range.setEnd(endNode, endOffset ?? 0)
  else range.collapse(true)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('copyLinkAtCaret', () => {
  let setData: ReturnType<typeof vi.fn>
  beforeEach(() => { setData = vi.fn() })

  function copy(container: HTMLElement) {
    const event = { currentTarget: container, clipboardData: { setData }, preventDefault: vi.fn() }
    return { event, handled: copyLinkAtCaret(event as unknown as React.ClipboardEvent<HTMLElement>) }
  }

  it('copies the URL when the caret is in the middle of a link', () => {
    const { container, link } = buildLink()
    select(link.firstChild!, 4)
    const result = copy(container)
    expect(result.handled).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', 'https://example.com/x')
    expect(result.event.preventDefault).toHaveBeenCalled()
  })

  it('leaves copy alone when the caret is outside the link', () => {
    const { container, plain } = buildLink()
    select(plain, 2)
    expect(copy(container).handled).toBe(false)
  })

  it('leaves copy alone when text is selected so the selection copies normally', () => {
    const { container, link } = buildLink()
    select(link.firstChild!, 0, link.firstChild!, 3)
    expect(copy(container).handled).toBe(false)
  })
})
