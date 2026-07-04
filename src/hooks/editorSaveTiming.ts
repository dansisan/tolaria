/**
 * Save-pipeline timing constants. Kept dependency-free so Playwright specs
 * can import them without pulling the app module graph into Node.
 */

/** Test seam: the Playwright fixture harness shrinks autosave timing via an
 * init-script global so specs exercise the same ordering relationships
 * without idle-waiting the production backstop interval. */
function autoSaveIdleOverrideMs(): number | null {
  const value = Reflect.get(globalThis, '__TOLARIA_AUTOSAVE_IDLE_MS')
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Idle window after the last buffered content change before autosave persists
 * (ADR-0136). Deliberately long: every interactive exit (note switch, raw-mode
 * toggle, Cmd+S / File→Save, destructive actions) flushes immediately, so this
 * is only a crash/quit backstop. Note: app quit does NOT flush.
 */
export const AUTO_SAVE_DEBOUNCE_MS = autoSaveIdleOverrideMs() ?? 30_000

/**
 * Must exceed the autosave idle window: the untitled H1 auto-rename reads the
 * note's H1 from disk, so a pending rename that outlives its buffered save
 * would act on stale content and rename to an outdated title.
 */
export const UNTITLED_RENAME_DEBOUNCE_MS = AUTO_SAVE_DEBOUNCE_MS + 1_000
