import {
  type BlockLike,
  type DurableBlockCodec,
  type DurableFencePayloadInput,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  readInlineText,
} from './durableMarkdownBlocks'

const TOKEN_PREFIX = '@@TOLARIA_NOWRAP_CODE_BLOCK:'
const TOKEN_SUFFIX = '@@'
const NOWRAP_FLAG = 'nowrap'
const SERIALIZED_PLAIN_LANGUAGES = new Set(['', 'text', 'none', 'plain', 'plaintext', 'txt'])

interface NowrapCodePayload {
  language: string
  code: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fence info with a `nowrap` token, e.g. "js nowrap" or just "nowrap". */
function readNowrapFenceMetadata(info: string): { language: string } | null {
  const tokens = info.trim().split(/\s+/u).filter(Boolean)
  if (!tokens.some((token) => token.toLowerCase() === NOWRAP_FLAG)) return null

  const [first = ''] = tokens
  return { language: first.toLowerCase() === NOWRAP_FLAG ? '' : first }
}

function readMetadataLanguage(metadata: unknown): string {
  return isRecord(metadata) && typeof metadata.language === 'string' ? metadata.language : ''
}

function buildNowrapPayload({ lines, start, end, metadata }: DurableFencePayloadInput): NowrapCodePayload {
  const code = lines.slice(start + 1, end).join('')
  return {
    language: readMetadataLanguage(metadata),
    code: code.endsWith('\n') ? code.slice(0, -1) : code,
  }
}

function decodeNowrapPayload(payload: unknown): NowrapCodePayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.language !== 'string') return null
  if (typeof payload.code !== 'string') return null
  return { language: payload.language, code: payload.code }
}

function buildNowrapCodeBlock(block: BlockLike, payload: NowrapCodePayload): BlockLike {
  return {
    ...block,
    type: 'codeBlock',
    props: {
      ...(block.props ?? {}),
      language: payload.language,
      nowrap: true,
    },
    content: payload.code === ''
      ? []
      : [{ type: 'text', text: payload.code, styles: {} }],
    children: [],
  }
}

function isNowrapCodeBlock(block: BlockLike): boolean {
  return block.type === 'codeBlock' && block.props?.nowrap === true
}

function fenceForCode(code: string): string {
  const longestRun = [...code.matchAll(/`{3,}/gu)]
    .reduce((longest, [run]) => Math.max(longest, run.length), 0)
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function fenceInfo(block: BlockLike): string {
  const language = typeof block.props?.language === 'string' ? block.props.language.trim() : ''
  if (SERIALIZED_PLAIN_LANGUAGES.has(language.toLowerCase())) return NOWRAP_FLAG
  return `${language} ${NOWRAP_FLAG}`
}

function nowrapCodeBlockMarkdown(block: BlockLike): string {
  const code = readInlineText(block.content) ?? ''
  const body = code === '' || code.endsWith('\n') ? code : `${code}\n`
  const fence = fenceForCode(code)
  return `${fence}${fenceInfo(block)}\n${body}${fence}`
}

export const nowrapCodeBlockMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: TOKEN_PREFIX,
  tokenSuffix: TOKEN_SUFFIX,
  readFenceMetadata: readNowrapFenceMetadata,
  buildPayload: buildNowrapPayload,
  decodePayload: decodeNowrapPayload,
  buildBlock: (block, payload) => buildNowrapCodeBlock(block, payload as NowrapCodePayload),
  isBlock: isNowrapCodeBlock,
  serializeBlock: nowrapCodeBlockMarkdown,
}

export function preProcessNowrapCodeBlockMarkdown({ markdown }: { markdown: string }): string {
  return preProcessDurableMarkdownBlocks({ markdown, codecs: [nowrapCodeBlockMarkdownCodec] })
}

export function injectNowrapCodeBlocks(blocks: unknown[]): unknown[] {
  return injectDurableMarkdownBlocks({ blocks, codecs: [nowrapCodeBlockMarkdownCodec] })
}
