import { describe, expect, it } from 'vitest'
import { codeBlockLineStarts } from './codeBlockLineNumberExtension'

describe('codeBlockLineStarts', () => {
  it('numbers a single line from its content start', () => {
    expect(codeBlockLineStarts('const x = 1', 1)).toEqual([{ pos: 1, line: 1 }])
  })

  it('opens line 2 at the position right after the newline', () => {
    // "ab\ncd" with content starting at doc position 1:
    // a=1 b=2 \n=3 c=4 d=5 → line 2 starts at 4.
    expect(codeBlockLineStarts('ab\ncd', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 4, line: 2 },
    ])
  })

  it('counts a trailing newline as a final empty line', () => {
    expect(codeBlockLineStarts('ab\n', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 4, line: 2 },
    ])
  })

  it('offsets every line by the given content start', () => {
    expect(codeBlockLineStarts('a\nb\nc', 10)).toEqual([
      { pos: 10, line: 1 },
      { pos: 12, line: 2 },
      { pos: 14, line: 3 },
    ])
  })

  it('treats empty content as a single line', () => {
    expect(codeBlockLineStarts('', 5)).toEqual([{ pos: 5, line: 1 }])
  })

  it('numbers consecutive blank lines', () => {
    expect(codeBlockLineStarts('\n\n', 1)).toEqual([
      { pos: 1, line: 1 },
      { pos: 2, line: 2 },
      { pos: 3, line: 3 },
    ])
  })
})
