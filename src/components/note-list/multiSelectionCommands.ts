export interface NoteListMultiSelectionCommands {
  selectedPaths: string[]
  deleteSelected?: () => void
  organizeSelected?: () => void
  toggleBulkMode?: () => void
}
