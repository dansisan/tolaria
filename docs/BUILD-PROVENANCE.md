# Build Provenance

Every build is stamped with an identifier that pins the artifact to an exact
code state, so a stray `.app` on disk can be matched back to its source. This
answers two questions: *which commit was this built from?* and *if the working
tree was dirty, what was uncommitted — and does it matter?*

## Where the stamp lives

One `buildId` is computed once by the Vite build and shared with the Rust
binary, so both sides always agree:

| Location | How to read it |
|---|---|
| Frontend JS bundle | `grep -rao '[0-9a-f]\{7,8\}\(-dirty-[0-9a-f]*\)\?' dist/assets` |
| Running app (devtools console) | `window.__TOLARIA_BUILD__` |
| Native binary | `strings Tolaria.app/Contents/MacOS/tolaria \| grep 'Tolaria build'` |
| Startup log | line `Tolaria build <buildId>` |
| Bundled manifest | `Tolaria.app/Contents/Resources/build-manifest.json` |

The stamp is produced in `vite.config.ts` (`resolveBuildInfo` + `buildIdPlugin`),
persisted to the gitignored `src-tauri/build-id.txt`, and read by
`src-tauri/build.rs`, which emits `BUILD_COMMIT` into the binary. `build.rs` also
writes a minimal fallback manifest for cargo-only builds (tests, `cargo build`)
so the declared bundle resource always resolves; it never overwrites the richer
manifest that Vite wrote.

## buildId format

- **Clean tree** → `<shortHash>` (e.g. `740e476a`). Fully reproducible; just
  confirm it matches `git rev-parse --short HEAD`.
- **Dirty tree** → `<shortHash>-dirty-<fingerprint>` (e.g.
  `740e476a-dirty-5cecd7e`). The `-dirty-` marker is the important signal: it was
  **not** built from a clean commit. A bare hash cannot distinguish a clean build
  from a dirty build on the same commit — hence the fingerprint.

## The manifest

`build-manifest.json` makes a stray dirty build self-describing rather than
hiding its state behind a one-way hash:

```json
{
  "buildId": "740e476a-dirty-5cecd7e",
  "commit": "740e476abd6fda243557c22e5a061b31ef8bfb52",
  "commitShort": "740e476a",
  "committedAt": "2026-07-04T23:07:36-04:00",
  "dirty": true,
  "fingerprint": "5cecd7e",
  "changes": [" M src/main.tsx", "?? src/buildInfo.ts"],
  "builtAt": "2026-07-10T15:11:32.228Z"
}
```

- `changes` — `git status --porcelain` lines (code + path), so you can *see* which
  files were uncommitted and judge relevance (a `?? src/foo.ts` source file vs a
  stray `?? notes.txt`). Leading spaces are significant status codes (` M`
  unstaged vs `M ` staged) — the generator reads status **raw**, never trimmed.
- `builtAt` — wall-clock build time. Deliberately **not** part of the fingerprint
  (so `buildId` stays reproducible), but recorded here so you can cross-check the
  on-disk mtimes of untracked files: anything modified after `builtAt` could not
  have been in the build.
- `committedAt` — the HEAD commit date, for reference.

## Reproducing the fingerprint

The `-dirty-<fingerprint>` value is reproducible: check out the same commit,
restore the same working-tree state, and run the recipe below. It must be run
from the repo root, and the git output must be treated **exactly** as specified —
`git status --porcelain` is read raw (only the trailing newline stripped; leading
spaces preserved), `git diff HEAD` is read raw, and the two are joined by a single
space (`" "`) before hashing.

```bash
node --input-type=module -e '
import { execSync } from "child_process";
import { createHash } from "crypto";
const git = (a) => execSync(`git ${a}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const raw = (a) => execSync(`git ${a}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const shortHash = git("rev-parse --short HEAD");
const status = raw("status --porcelain").replace(/\n+$/, "");   // raw: keep leading spaces
if (status === "") { console.log(shortHash); process.exit(0); } // clean → bare hash
const diff = raw("diff HEAD");
const fingerprint = createHash("sha1").update(diff).update(" ").update(status).digest("hex").slice(0, 7);
console.log(`${shortHash}-dirty-${fingerprint}`);
'
```

Definition of the fingerprint, precisely:

```
fingerprint = sha1( <git diff HEAD raw> + " " + <git status --porcelain, trailing newline stripped> )
              .hex()[0:7]
```

### Caveats

- The fingerprint only reproduces if the working tree is byte-identical. This
  lets you *verify a candidate tree* against a build; it does not let you *derive*
  the tree from the fingerprint alone (that's what the manifest's `changes` list
  and, if you keep it, the diff are for).
- `git status --porcelain` reports untracked files, so it is sensitive to
  transient junk in the tree (`.DS_Store`, editor swap files, build-tool temp
  files). This can shift the fingerprint for reasons unrelated to your source —
  but only ever in the direction of "looks more dirty," never "looks falsely
  clean," which is the safe direction for provenance.
- Do not run the recipe from a JS context that itself writes a temp file into the
  repo root before calling git (this bit us once with a transpiled config), and
  never left-trim the porcelain output.
