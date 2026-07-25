/**
 * Regenerates the persistent big-note fixtures in tests/fixtures/perf-vault.
 * These are checked in and kept around for reproducing large-note problems
 * (switch lag, content bleeding, autosave races). Deterministic output —
 * rerunning produces identical files.
 *
 *   node scripts/make-perf-vault.mjs [--size-kb 100]
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve('tests/fixtures/perf-vault')
const sizeArgIndex = process.argv.indexOf('--size-kb')
const SIZE_KB = sizeArgIndex === -1 ? 100 : Number(process.argv[sizeArgIndex + 1])
const TARGET_BYTES = SIZE_KB * 1024

const SENTENCES = [
  'The migration plan covers the primary database cluster and both read replicas across regions.',
  'Each service owner signs off on the cutover checklist before the maintenance window opens.',
  'Rollback requires restoring the snapshot taken at the start of the window and replaying the queue.',
  'Monitoring dashboards track replication lag, error rates, and p99 latency during the transition.',
  'The team agreed to freeze schema changes for one week on either side of the migration date.',
]

function paragraphBody(marker, targetBytes) {
  let body = ''
  let i = 0
  while (body.length < targetBytes) {
    if (i % 30 === 0) body += `## ${marker} section ${i / 30 + 1}\n\n`
    body += `${marker}-p${i}: ${SENTENCES[i % 5]} ${SENTENCES[(i + 1) % 5]} ${SENTENCES[(i + 2) % 5]}\n\n`
    i += 1
  }
  return body
}

/** Single-spaced lines parse into one giant block — the known editor worst case. */
function giantBlockBody(marker, targetBytes) {
  let body = ''
  let i = 0
  while (body.length < targetBytes) {
    body += `${marker}-line${i}: ${SENTENCES[i % 5]}\n`
    i += 1
  }
  return body
}

/**
 * Thousands of SHORT single-spaced lines. Distinct from giantBlockBody: the editor
 * cost of this shape tracks the number of line breaks, not the byte count, because
 * every newline inside a block becomes its own hardBreak node for ProseMirror to
 * build. Real-world journals hit ~9k lines in ~150KB; that is the 1s-switch case.
 */
function denseLineBody(marker, lineCount) {
  const FRAGMENTS = ['ok', 'done', 'todo: ping', 'no change', 'follow up', 'shipped', 'waiting', 'n/a']
  let body = ''
  for (let i = 0; i < lineCount; i += 1) {
    body += `${marker}-${i} ${FRAGMENTS[i % FRAGMENTS.length]}\n`
  }
  return body
}

function note(title, marker, body) {
  return `---\ntype: Note\n---\n\n# ${title}\n\nUNIQUE-MARKER: ${marker}\n\n${body}`
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const files = {
  'huge-note-x.md': note('Huge Note X', 'HUGE-NOTE-X', paragraphBody('xray', TARGET_BYTES * 3)),
  'huge-note-y.md': note('Huge Note Y', 'HUGE-NOTE-Y', paragraphBody('yankee', TARGET_BYTES * 3)),
  'big-note-a.md': note('Big Note A', 'BIG-NOTE-A', paragraphBody('alpha', TARGET_BYTES)),
  'big-note-b.md': note('Big Note B', 'BIG-NOTE-B', paragraphBody('bravo', TARGET_BYTES)),
  'big-note-c.md': note('Big Note C', 'BIG-NOTE-C', paragraphBody('charlie', TARGET_BYTES)),
  'giant-block.md': note('Giant Block', 'GIANT-BLOCK', giantBlockBody('golf', TARGET_BYTES)),
  'dense-lines.md': note('Dense Lines', 'DENSE-LINES', denseLineBody('delta', 9000)),
  'small-control.md': note('Small Control', 'SMALL-CONTROL', 'A small note for contrast.\n'),
  'README.md': [
    '# perf-vault — persistent big-note fixtures',
    '',
    'Kept in the repo (not cleaned up) for reproducing large-note problems:',
    'switch lag, content bleeding between notes, autosave races.',
    '',
    '- Tests must COPY this directory (see `createPerfVaultCopy`) — never edit in place.',
    '- For manual QA, open this folder as a vault; `git checkout -- tests/fixtures/perf-vault`',
    '  restores it afterwards.',
    '- Regenerate or scale with `node scripts/make-perf-vault.mjs [--size-kb N]`.',
    '- `dense-lines.md` is the worst case for document install: ~9k short single-spaced',
    '  lines, so cost tracks line (hardBreak) count rather than bytes.',
    '',
    'Each note carries `UNIQUE-MARKER: <NAME>` plus per-paragraph prefixes so any',
    'cross-note content bleeding is detectable by grep.',
    '',
  ].join('\n'),
}

for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT_DIR, name), content)
  console.log(`${name}: ${(content.length / 1024).toFixed(1)}KB`)
}
