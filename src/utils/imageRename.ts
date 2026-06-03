/** How pasted/dropped images are (optionally) renamed after they are saved. */
export type ImageRenameMode = 'off' | 'command'

export const DEFAULT_IMAGE_RENAME_MODE: ImageRenameMode = 'off'
export const IMAGE_RENAME_MODES: readonly ImageRenameMode[] = ['off', 'command']

/** Pre-filled command path for the Settings field (the `~` is expanded when run). */
export const DEFAULT_IMAGE_RENAME_COMMAND = '~/Code/obsidian-config/scripts/name_image.sh'

export function normalizeImageRenameMode(value: unknown): ImageRenameMode {
  return value === 'command' ? 'command' : 'off'
}

/**
 * The external command to run for naming a pasted image, or null when renaming
 * is off or no command is configured. Tolaria invokes it as
 * `<command> <absolute-image-path>` and reads the desired filename from stdout.
 */
export function resolveImageRenameCommand(mode: unknown, command: unknown): string | null {
  if (normalizeImageRenameMode(mode) !== 'command') return null
  const trimmed = typeof command === 'string' ? command.trim() : ''
  return trimmed === '' ? null : trimmed
}
