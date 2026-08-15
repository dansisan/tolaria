import { useEffect, useRef, useState } from 'react'
import type { GitCommit } from '../types'

const GIT_HISTORY_LOAD_DELAY_MS = 500

export function useGitHistory(
  activeTabPath: string | null,
  loadGitHistory: (path: string) => Promise<GitCommit[]>,
  enabled = true,
  latestCommitHash?: string,
) {
  const [loadedHistory, setLoadedHistory] = useState<{
    path: string | null
    commits: GitCommit[]
  }>({
    path: null,
    commits: [],
  })

  // The loader closes over git status, which is rebuilt on every poll. Keying the
  // effect to its identity meant each poll restarted the debounce below and threw
  // away the in-flight result, so on a vault with pending changes the panel could
  // be starved for seconds. Reading it through a ref keys the effect to what
  // actually changes the answer instead: the note, and the newest commit.
  const loadRef = useRef(loadGitHistory)
  useEffect(() => {
    loadRef.current = loadGitHistory
  }, [loadGitHistory])

  useEffect(() => {
    if (!enabled || !activeTabPath) return

    let cancelled = false

    const timeoutId = window.setTimeout(() => {
      void loadRef.current(activeTabPath).then((history) => {
        if (cancelled) return
        setLoadedHistory({
          path: activeTabPath,
          commits: history,
        })
      })
    }, GIT_HISTORY_LOAD_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeTabPath, enabled, latestCommitHash])

  return enabled && activeTabPath && loadedHistory.path === activeTabPath
    ? loadedHistory.commits
    : []
}
