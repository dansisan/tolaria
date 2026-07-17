import { useEffect, useRef, useState, type RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent as TauriDragDropPayload } from '@tauri-apps/api/webview'
import { isTauri } from '../mock-tauri'
import { cleanupTauriEventListeners } from '../utils/tauriEventCleanup'
import { attachmentAssetUrlFromPath } from '../utils/vaultAttachments'

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff']
const TAURI_DRAG_DROP_EVENT = 'tauri://drag-drop'
const TAURI_DRAG_LEAVE_EVENT = 'tauri://drag-leave'

type ImageUrlHandler = (url: string) => void
type InternalVaultWriteHandler = (path: string) => void
type TauriDropEvent = TauriEvent<TauriDragDropPayload>
type CopyImageToVaultRequest = {
  sourcePath: string
  vaultPath: string
  onInternalVaultWrite: InternalVaultWriteHandler | undefined
}
type DroppedImagesRequest = {
  imagePaths: string[]
  vaultPath: string | undefined
  onImageUrl: ImageUrlHandler | undefined
  onInternalVaultWrite: InternalVaultWriteHandler | undefined
}

function hasImageFiles(dt: DataTransfer): boolean {
  for (let i = 0; i < dt.items.length; i++) {
    const item = Reflect.get(dt.items, i) as DataTransferItem | undefined
    if (item?.kind === 'file' && IMAGE_MIME_TYPES.includes(item.type)) return true
  }
  return false
}

function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}

/** Run the optional AI rename command on a just-saved attachment; on any failure keep the saved path. */
async function applyImageRenameCommand(
  vaultPath: string,
  savedPath: string,
  renameCommand?: string,
  onInternalVaultWrite?: InternalVaultWriteHandler,
): Promise<string> {
  if (!renameCommand) return savedPath
  try {
    const renamedPath = await invoke<string>('rename_pasted_image', { vaultPath, imagePath: savedPath, command: renameCommand })
    onInternalVaultWrite?.(renamedPath)
    return renamedPath
  } catch {
    return savedPath
  }
}

/**
 * Upload an image file — saves to vault/attachments in Tauri, returns data URL in browser.
 * When `renameCommand` is set, the saved file is renamed via that command before the URL
 * is returned (so the editor inserts the final name); failures fall back to the saved name.
 */
export async function uploadImageFile(
  file: File,
  vaultPath?: string,
  renameCommand?: string,
  onInternalVaultWrite?: InternalVaultWriteHandler,
): Promise<string> {
  if (isTauri() && vaultPath) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes.at(i) ?? 0)
    const base64 = btoa(binary)
    const savedPath = await invoke<string>('save_image', {
      vaultPath,
      filename: file.name,
      data: base64,
    })
    onInternalVaultWrite?.(savedPath)
    const finalPath = await applyImageRenameCommand(vaultPath, savedPath, renameCommand, onInternalVaultWrite)
    return attachmentAssetUrlFromPath({ path: finalPath })
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Copy a dropped file (by OS path) into vault/attachments and return its asset URL. */
async function copyImageToVault({
  sourcePath,
  vaultPath,
  onInternalVaultWrite,
}: CopyImageToVaultRequest): Promise<string> {
  const savedPath = await invoke<string>('copy_image_to_vault', { vaultPath, sourcePath })
  onInternalVaultWrite?.(savedPath)
  return attachmentAssetUrlFromPath({ path: savedPath })
}

function insertDroppedImages({
  imagePaths,
  vaultPath,
  onImageUrl,
  onInternalVaultWrite,
}: DroppedImagesRequest): void {
  if (imagePaths.length === 0) return
  if (!vaultPath || !onImageUrl) return

  for (const sourcePath of imagePaths) {
    void copyImageToVault({ sourcePath, vaultPath, onInternalVaultWrite }).then(onImageUrl)
  }
}

async function registerNativeDropListeners(
  handler: (event: TauriDropEvent) => void,
): Promise<UnlistenFn[]> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  const webview = getCurrentWebview()
  const unlisteners: UnlistenFn[] = []

  try {
    unlisteners.push(await webview.listen<TauriDragDropPayload>(TAURI_DRAG_DROP_EVENT, handler))
    unlisteners.push(await webview.listen<TauriDragDropPayload>(TAURI_DRAG_LEAVE_EVENT, handler))
    return unlisteners
  } catch (error) {
    cleanupTauriEventListeners(unlisteners)
    throw error
  }
}

interface UseImageDropOptions {
  containerRef: RefObject<HTMLDivElement | null>
  /** Called with an asset URL for each image dropped via Tauri native drag-drop. */
  onImageUrl?: (url: string) => void
  /** Marks a path as a known-recent internal write so the vault file watcher's
   *  generic "unknown path changed" fallback doesn't redundantly rescan the
   *  whole vault a moment after a dropped image we already know about. */
  onInternalVaultWrite?: InternalVaultWriteHandler
  vaultPath?: string
}

export function useImageDrop({ containerRef, onImageUrl, onInternalVaultWrite, vaultPath }: UseImageDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false)
  const onImageUrlRef = useRef(onImageUrl)
  useEffect(() => { onImageUrlRef.current = onImageUrl }, [onImageUrl])
  const onInternalVaultWriteRef = useRef(onInternalVaultWrite)
  useEffect(() => { onInternalVaultWriteRef.current = onInternalVaultWrite }, [onInternalVaultWrite])
  const vaultPathRef = useRef(vaultPath)
  useEffect(() => { vaultPathRef.current = vaultPath }, [vaultPath])

  // HTML5 DnD visual feedback; BlockNote handles browser-mode uploads.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !hasImageFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        setIsDragOver(false)
      }
    }

    const handleDrop = () => {
      setIsDragOver(false)
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('dragleave', handleDragLeave)
    container.addEventListener('drop', handleDrop)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('dragleave', handleDragLeave)
      container.removeEventListener('drop', handleDrop)
    }
  }, [containerRef])

  // Tauri native file drop intercepts OS file drops that bypass HTML5 DnD.
  useEffect(() => {
    if (!isTauri()) return

    let unlisteners: UnlistenFn[] = []
    let mounted = true

    void (async () => {
      try {
        const nextUnlisteners = await registerNativeDropListeners((event) => {
          if (event.payload.type === 'drop') {
            setIsDragOver(false)
            insertDroppedImages({
              imagePaths: event.payload.paths.filter(isImagePath),
              vaultPath: vaultPathRef.current,
              onImageUrl: onImageUrlRef.current,
              onInternalVaultWrite: onInternalVaultWriteRef.current,
            })
            return
          }
          setIsDragOver(false)
        })
        if (mounted) unlisteners = nextUnlisteners
        else cleanupTauriEventListeners(nextUnlisteners)
      } catch {
        // Tauri webview API not available.
      }
    })()

    return () => {
      mounted = false
      cleanupTauriEventListeners(unlisteners)
      unlisteners = []
    }
  }, [])

  return { isDragOver }
}
