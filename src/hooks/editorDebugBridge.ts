import { useEffect } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'

declare global {
  interface Window {
    __tolariaDebugEditor?: ReturnType<typeof useCreateBlockNote>
  }
}

/**
 * Dev-only bridge exposing the live BlockNote editor instance on `window`,
 * so Playwright benchmarks can call editor.tryParseMarkdownToBlocks /
 * replaceBlocks directly — isolating BlockNote's own cost from Tolaria's
 * caching and tab-swap wrapper (see tests/smoke/perf-editor-core-benchmark.spec.ts).
 * Mirrors the window.__tolariaEditorMemoryProbe pattern in EditorMemoryProbe.tsx.
 */
export function useEditorDebugBridge(editor: ReturnType<typeof useCreateBlockNote>): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tolariaDebugEditor = editor
    return () => {
      if (window.__tolariaDebugEditor === editor) delete window.__tolariaDebugEditor
    }
  }, [editor])
}
