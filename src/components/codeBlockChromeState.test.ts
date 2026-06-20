import { describe, expect, it } from 'vitest'
import { codeBlockText } from './codeBlockChromeState'
import { CODE_LINE_NUMBER_CLASS } from './codeBlockLineNumberExtension'

function codeBlockWith(innerHtml: string): HTMLElement {
  const block = document.createElement('div')
  block.innerHTML = `<pre><code>${innerHtml}</code></pre>`
  return block
}

describe('codeBlockText', () => {
  it('returns the code text when there is no gutter', () => {
    expect(codeBlockText(codeBlockWith('const x = 1\nconst y = 2'))).toBe('const x = 1\nconst y = 2')
  })

  it('strips line-number widgets so copy yields pure source', () => {
    const block = codeBlockWith(
      `<span class="${CODE_LINE_NUMBER_CLASS}">1</span>const x = 1\n`
      + `<span class="${CODE_LINE_NUMBER_CLASS}">2</span>const y = 2`,
    )
    expect(codeBlockText(block)).toBe('const x = 1\nconst y = 2')
  })

  it('returns an empty string when the block has no code element', () => {
    expect(codeBlockText(document.createElement('div'))).toBe('')
  })
})
