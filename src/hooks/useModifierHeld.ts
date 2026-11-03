import { useEffect, useState } from 'react'
import { isMac } from '../utils/platform'

const REVEAL_DELAY_MS = 250

export type HeldModifierMode = 'command' | 'ctrl-alt' | null

interface HeldKeys {
  meta: boolean
  ctrl: boolean
  alt: boolean
}

function modifierName(event: KeyboardEvent): keyof HeldKeys | null {
  if (event.key === 'Meta') return 'meta'
  if (event.key === 'Control') return 'ctrl'
  if (event.key === 'Alt') return 'alt'
  return null
}

/** The modifier set currently held on its own, or null when none of our shortcut sets is. */
function resolveMode({ meta, ctrl, alt }: HeldKeys, mac: boolean): HeldModifierMode {
  if (ctrl && alt && !(mac && meta)) return 'ctrl-alt'
  const commandDown = mac ? meta && !ctrl : ctrl
  return commandDown && !alt ? 'command' : null
}

/**
 * Reports which shortcut modifier set is being held on its own: the platform
 * command key (⌘ / Ctrl) or Control+Option. Only reports after a short hold so
 * executing a shortcut quickly never flashes hints.
 */
export function useHeldModifierMode(): HeldModifierMode {
  const [mode, setMode] = useState<HeldModifierMode>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const held: HeldKeys = { meta: false, ctrl: false, alt: false }

    const clearTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const reset = () => {
      clearTimer()
      held.meta = held.ctrl = held.alt = false
      setMode(null)
    }
    const sync = () => {
      clearTimer()
      const next = resolveMode(held, isMac())
      // Changing the held set hides stale hints immediately.
      setMode((current) => (current === next ? current : null))
      if (next) timer = setTimeout(() => setMode(next), REVEAL_DELAY_MS)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const name = modifierName(event)
      if (!name) {
        // Shift alone is irrelevant; any other key means a shortcut is being executed.
        if (event.key === 'Shift') return
        clearTimer()
        setMode(null)
        return
      }
      if (event.repeat) return
      held[name] = true
      sync()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const name = modifierName(event)
      if (!name) return
      held[name] = false
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
