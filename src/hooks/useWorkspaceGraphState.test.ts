import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Settings } from '../types'
import type { VaultOption } from '../components/status-bar/types'
import { useWorkspaceGraphState } from './useWorkspaceGraphState'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve('')) }))
vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(() => Promise.resolve('')),
}))

const vaults: VaultOption[] = [
  { label: 'Personal', path: '/personal' },
  { label: 'Team', path: '/team' },
  { label: 'Archive', path: '/archive' },
]

function settingsWithMultiWorkspace(enabled: boolean | null): Settings {
  return { multi_workspace_enabled: enabled } as Settings
}

function renderGraphState(multiWorkspaceEnabled: boolean | null) {
  return renderHook(() => useWorkspaceGraphState({
    allVaults: vaults,
    defaultWorkspacePath: '/personal',
    resolvedPath: '/personal',
    settings: settingsWithMultiWorkspace(multiWorkspaceEnabled),
    vaultSwitcherLoaded: true,
    windowMode: false,
  }))
}

describe('useWorkspaceGraphState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('never loads the other vaults while multiple workspaces are off', () => {
    const { result } = renderGraphState(null)

    expect(result.current.graphVaults).toBeUndefined()
    expect(result.current.folderVaults).toBeUndefined()
    expect(result.current.visibleWorkspacePathList).toEqual(['/personal'])
    expect(result.current.writableVaultPaths).toEqual(['/personal'])
  })

  it('loads every available vault once multiple workspaces are on', () => {
    const { result } = renderGraphState(true)

    expect(result.current.graphVaults?.map((vault) => vault.path)).toEqual([
      '/personal',
      '/team',
      '/archive',
    ])
    expect(result.current.visibleWorkspacePathList).toEqual(['/personal', '/team', '/archive'])
  })
})
