import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { GitSetupPreference } from '../types'

export type { GitSetupPreference } from '../types'

export type GitRepoState = 'checking' | 'missing' | 'ready'
type GitRepoStatus = { path: string; state: GitRepoState }

interface GitSetupStateConfig {
  gitSetupPreference?: GitSetupPreference | null
  onGitSetupPreferenceChange?: (preference: GitSetupPreference) => void
  onToast: (message: string | null) => void
  resolvedPath: string
  vaultPathSettled?: boolean
  windowMode: boolean
}

function checkGitRepo(resolvedPath: string): Promise<boolean> {
  return isTauri()
    ? invoke<boolean>('is_git_repo', { vaultPath: resolvedPath })
    : mockInvoke<boolean>('is_git_repo', { vaultPath: resolvedPath })
}

function useCheckedGitRepoState(resolvedPath: string) {
  const [gitRepoStatus, setGitRepoStatus] = useState<GitRepoStatus>({
    path: '',
    state: 'checking',
  })
  const gitRepoState = gitRepoStatus.path === resolvedPath ? gitRepoStatus.state : 'checking'

  useEffect(() => {
    if (!resolvedPath) return
    let cancelled = false
    checkGitRepo(resolvedPath)
      .then(isGit => {
        if (!cancelled) setGitRepoStatus({ path: resolvedPath, state: isGit ? 'ready' : 'missing' })
      })
      .catch(() => {
        if (!cancelled) setGitRepoStatus({ path: resolvedPath, state: 'ready' })
      })
    return () => {
      cancelled = true
    }
  }, [resolvedPath])

  const markGitRepoReady = useCallback(() => {
    setGitRepoStatus({ path: resolvedPath, state: 'ready' })
  }, [resolvedPath])

  return { gitRepoState, markGitRepoReady }
}

function shouldShowGitSetupDialog({
  dismissedGitSetupPath,
  gitRepoState,
  gitSetupPreference,
  manuallyOpened,
  resolvedPath,
  vaultPathSettled,
  windowMode,
}: {
  dismissedGitSetupPath: string | null
  gitRepoState: GitRepoState
  gitSetupPreference: GitSetupPreference | null | undefined
  manuallyOpened: boolean
  resolvedPath: string
  vaultPathSettled: boolean
  windowMode: boolean
}): boolean {
  if (windowMode || gitRepoState !== 'missing') return false
  if (manuallyOpened) return true
  // Don't auto-prompt until the persisted vault list has selected the active
  // vault. Before that the path in state is not one the user opened, and its
  // per-vault "never" preference has not been read either.
  if (!vaultPathSettled) return false
  return gitSetupPreference !== 'never' && dismissedGitSetupPath !== resolvedPath
}

export function useGitSetupState({
  gitSetupPreference = 'prompt',
  onGitSetupPreferenceChange,
  onToast,
  resolvedPath,
  vaultPathSettled = true,
  windowMode,
}: GitSetupStateConfig) {
  const [dismissedGitSetupPath, setDismissedGitSetupPath] = useState<string | null>(null)
  const [manuallyOpened, setManuallyOpened] = useState(false)
  const { gitRepoState, markGitRepoReady } = useCheckedGitRepoState(resolvedPath)

  const openGitSetupDialog = useCallback(() => {
    if (gitRepoState !== 'missing') return
    setManuallyOpened(true)
    setDismissedGitSetupPath(null)
  }, [gitRepoState])

  const dismissGitSetupDialog = useCallback(() => {
    setManuallyOpened(false)
    setDismissedGitSetupPath(resolvedPath)
  }, [resolvedPath])

  const neverForVaultGitSetupDialog = useCallback(() => {
    onGitSetupPreferenceChange?.('never')
    setManuallyOpened(false)
    setDismissedGitSetupPath(resolvedPath)
  }, [onGitSetupPreferenceChange, resolvedPath])

  const handleInitGitRepo = useCallback(async () => {
    if (isTauri()) {
      await invoke('init_git_repo', { vaultPath: resolvedPath })
    } else {
      await mockInvoke('init_git_repo', { vaultPath: resolvedPath })
    }
    markGitRepoReady()
    onGitSetupPreferenceChange?.('prompt')
    setManuallyOpened(false)
    setDismissedGitSetupPath(null)
    onToast('Git initialized for this vault')
  }, [markGitRepoReady, onGitSetupPreferenceChange, onToast, resolvedPath])

  const showGitSetupDialog = shouldShowGitSetupDialog({
    dismissedGitSetupPath,
    gitRepoState,
    gitSetupPreference,
    manuallyOpened,
    resolvedPath,
    vaultPathSettled,
    windowMode,
  })

  return {
    dismissGitSetupDialog,
    gitRepoState,
    handleInitGitRepo,
    neverForVaultGitSetupDialog,
    openGitSetupDialog,
    showGitSetupDialog,
    shouldShowGitSetupDialog: showGitSetupDialog,
  }
}
