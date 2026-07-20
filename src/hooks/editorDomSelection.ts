export const EDITOR_CONTAINER_SELECTOR = '.editor__blocknote-container'

const EDITOR_EDITABLE_SELECTOR = `${EDITOR_CONTAINER_SELECTOR} [contenteditable="true"]`

// Reading Selection properties (e.g. `anchorNode`) forces the browser to
// resolve the selection against current layout, which flushes any pending
// style/layout work synchronously — costly in a large vault where lots of
// DOM has just been mutated (e.g. note-list highlight changes). Skip that
// read entirely until the editor has actually held a focus or selection at
// least once; keyboard-only navigation (arrow keys in the note list) never
// touches the editor, so there is never a stale selection inside it to clear.
let editorMayHaveSelection = false

function handleEditorFocusIn(event: FocusEvent): void {
  if (editorMayHaveSelection) return
  const target = event.target
  if (!(target instanceof Element)) return
  if (isElementInsideEditor(target, getEditorContainers())) {
    editorMayHaveSelection = true
  }
}

function handleSelectionChange(): void {
  if (editorMayHaveSelection) return
  const selection = document.getSelection()
  if (!selection) return
  const containers = getEditorContainers()
  if (isNodeInsideEditor(selection.anchorNode, containers) || isNodeInsideEditor(selection.focusNode, containers)) {
    editorMayHaveSelection = true
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', handleEditorFocusIn)
  document.addEventListener('selectionchange', handleSelectionChange)
}

export function resetEditorFocusTrackingForTest(): void {
  editorMayHaveSelection = false
}

function getElementForNode(node: Node | null): Element | null {
  if (node instanceof Element) return node
  return node?.parentElement ?? null
}

function getEditorContainers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(EDITOR_CONTAINER_SELECTOR))
}

function isElementInsideEditor(element: Element | null, containers: HTMLElement[]): boolean {
  return Boolean(element && containers.some((container) => container.contains(element)))
}

function isNodeInsideEditor(node: Node | null, containers: HTMLElement[]): boolean {
  return isElementInsideEditor(getElementForNode(node), containers)
}

function blurActiveEditorElement(containers: HTMLElement[]): void {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return
  if (!isElementInsideEditor(activeElement, containers)) return

  activeElement.blur()
}

function clearSelectionIfInsideEditor(
  selection: Selection | null,
  containers: HTMLElement[],
): void {
  if (!selection) return

  const hasEditorAnchor = isNodeInsideEditor(selection.anchorNode, containers)
  const hasEditorFocus = isNodeInsideEditor(selection.focusNode, containers)
  if (!hasEditorAnchor && !hasEditorFocus) return

  selection.removeAllRanges()
}

function blurEditorEditableElements(): void {
  for (const editable of document.querySelectorAll<HTMLElement>(EDITOR_EDITABLE_SELECTOR)) {
    editable.blur()
  }
}

export function clearEditorDomSelection(): void {
  if (!editorMayHaveSelection) return

  const containers = getEditorContainers()
  if (containers.length === 0) return

  blurActiveEditorElement(containers)
  clearSelectionIfInsideEditor(window.getSelection(), containers)
  blurEditorEditableElements()
}
