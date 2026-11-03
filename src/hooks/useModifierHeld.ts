import { useEffect, useState } from 'react'
import { isMac } from '../utils/platform'

const REVEAL_DELAY_MS = 250

export type HeldModifierMode = 'command' | 'command-shift' | null

function isCommandKey(event: KeyboardEvent): boolean {
  return isMac() ? event.key === 'Meta' : event.key === 'Control'
}

function isModifierKey(event: KeyboardEvent): boolean {
  return isCommandKey(event) || event.key === 'Shift'
}

/**
 * Reports which shortcut modifier set is being held on its own: the platform
 * command key (⌘ / Ctrl), optionally with Shift. Only reports after a short
 * hold so executing a shortcut quickly never flashes hints.
 */
export function useHeldModifierMode(): HeldModifierMode {
  const [mode, setMode] = useState<HeldModifierMode>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let commandDown = false
    let shiftDown = false

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const reset = () => {
      clearTimer()
      commandDown = false
      shiftDown = false
      setMode(null)
    }
    const sync = () => {
      clearTimer()
      if (!commandDown) {
        setMode(null)
        return
      }
      const next: HeldModifierMode = shiftDown ? 'command-shift' : 'command'
      timer = setTimeout(() => setMode(next), REVEAL_DELAY_MS)
      // Changing the held set (e.g. adding Shift) hides stale hints immediately.
      setMode((current) => (current === next ? current : null))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isModifierKey(event)) {
        // A real shortcut is being executed: hide hints and wait for release.
        clearTimer()
        setMode(null)
        return
      }
      if (event.repeat) return
      if (isCommandKey(event)) commandDown = true
      else shiftDown = true
      sync()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isModifierKey(event)) return
      if (isCommandKey(event)) commandDown = false
      else shiftDown = false
      sync()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', reset)
    return () => {
      reset()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', reset)
    }
  }, [])

  return mode
}
