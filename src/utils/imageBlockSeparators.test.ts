import { describe, expect, it } from 'vitest'
import { separateImageBlockLines } from './imageBlockSeparators'

describe('separateImageBlockLines', () => {
  it('inserts a blank line between preceding text and an own-line image', () => {
    expect(separateImageBlockLines({ markdown: 'Here is my dog:\n![](attachments/dog.webp)' }))
      .toBe('Here is my dog:\n\n![](attachments/dog.webp)')
  })

  it('inserts a blank line between an own-line image and following text', () => {
    expect(separateImageBlockLines({ markdown: '![](attachments/dog.webp)\nmore text' }))
      .toBe('![](attachments/dog.webp)\n\nmore text')
  })

  it('separates an image wedged between two text lines on both sides', () => {
    expect(separateImageBlockLines({ markdown: 'before\n![](attachments/dog.webp)\nafter' }))
      .toBe('before\n\n![](attachments/dog.webp)\n\nafter')
  })

  it('leaves an already block-separated image untouched (idempotent)', () => {
    const markdown = 'Here is my dog:\n\n![](attachments/dog.webp)\n\nmore text'
    expect(separateImageBlockLines({ markdown })).toBe(markdown)
    expect(separateImageBlockLines({ markdown: separateImageBlockLines({ markdown }) })).toBe(markdown)
  })

  it('leaves a standalone image untouched', () => {
    expect(separateImageBlockLines({ markdown: '![](attachments/dog.webp)' }))
      .toBe('![](attachments/dog.webp)')
  })

  it('separates consecutive own-line images from surrounding text', () => {
    expect(separateImageBlockLines({ markdown: 'intro\n![](a.webp)\n![](b.webp)\noutro' }))
      .toBe('intro\n\n![](a.webp)\n\n![](b.webp)\n\noutro')
  })

  it('handles trailing whitespace after the image markup', () => {
    expect(separateImageBlockLines({ markdown: 'caption\n![](attachments/dog.webp)   ' }))
      .toBe('caption\n\n![](attachments/dog.webp)   ')
  })

  it('does not touch a truly inline image sharing a line with text', () => {
    const markdown = 'My dog ![](attachments/dog.webp) is cute'
    expect(separateImageBlockLines({ markdown })).toBe(markdown)
  })

  it('does not touch an indented image (list/blockquote continuation)', () => {
    const markdown = '- item\n  ![](attachments/dog.webp)'
    expect(separateImageBlockLines({ markdown })).toBe(markdown)
  })

  it('does not touch a list item whose content is an image', () => {
    const markdown = '- ![](attachments/dog.webp)'
    expect(separateImageBlockLines({ markdown })).toBe(markdown)
  })

  it('does not promote image markup inside a fenced code block', () => {
    const markdown = '```\n![](attachments/dog.webp)\n```'
    expect(separateImageBlockLines({ markdown })).toBe(markdown)
  })

  it('separates an image immediately before a fenced code block', () => {
    expect(separateImageBlockLines({ markdown: '![](attachments/dog.webp)\n```\ncode\n```' }))
      .toBe('![](attachments/dog.webp)\n\n```\ncode\n```')
  })
})
