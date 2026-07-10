declare const __BUILD_COMMIT__: string

/**
 * Git build stamp injected at build time (see `vite.config.ts` and
 * `src-tauri/build.rs`). Clean build → short commit hash; dirty build →
 * `<hash>-dirty-<fingerprint>`. Lets you confirm which code state a shipped
 * artifact was built from. `dev` when running under the Vite dev server.
 */
export const BUILD_COMMIT: string =
  typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev'
