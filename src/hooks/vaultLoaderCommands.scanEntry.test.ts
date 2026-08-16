import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanVaultEntry } from './vaultLoaderCommands'
import type { VaultOption } from '../components/status-bar/types'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: (command: string, args?: Record<string, unknown>) => mockInvoke(command, args),
}))

const vaults: VaultOption[] = [
  { label: 'Personal', path: '/personal', available: true, mounted: true },
  { label: 'Team', path: '/team', available: true, mounted: true },
]

describe('scanVaultEntry', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('normalizes a path the entry list does not hold yet', async () => {
    mockInvoke.mockResolvedValue({ path: '/personal/new.md', filename: 'new.md', title: 'New' })

    const entry = await scanVaultEntry({ path: '/personal/new.md' })

    expect(mockInvoke).toHaveBeenCalledWith('scan_vault_entry', { path: '/personal/new.md' })
    expect(entry).toMatchObject({ path: '/personal/new.md', title: 'New', aliases: [] })
  })

  it('tags the entry with the workspace that owns the path', async () => {
    mockInvoke.mockResolvedValue({ path: '/team/new.md', filename: 'new.md', title: 'New' })

    const entry = await scanVaultEntry({ path: '/team/new.md', vaults })

    expect(entry?.workspace).toMatchObject({ label: 'Team', path: '/team' })
  })

  it('passes through the backend verdict that a path is not a vault entry', async () => {
    mockInvoke.mockResolvedValue(null)

    expect(await scanVaultEntry({ path: '/personal/New Folder' })).toBeNull()
  })
})
