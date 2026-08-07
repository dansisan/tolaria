/** Fired to show a short user-visible message in the app shell's toast. */
export const TOAST_EVENT = 'laputa:toast'

/**
 * Show a toast from a component too deep in the tree to reach App's toast
 * state. Hooks that App calls directly should keep taking an `onToast` prop —
 * this exists for leaves like the breadcrumb, which would otherwise need the
 * callback threaded through the editor layout and its action bundle.
 */
export function requestToast(message: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}

/** Deliver TOAST_EVENT messages to the shell. Returns an unsubscribe function. */
export function subscribeToToasts(onToast: (message: string) => void): () => void {
  const handleToast = (event: Event) => {
    const { detail } = event as CustomEvent<unknown>
    if (typeof detail === 'string' && detail !== '') onToast(detail)
  }
  window.addEventListener(TOAST_EVENT, handleToast)
  return () => window.removeEventListener(TOAST_EVENT, handleToast)
}
