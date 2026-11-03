import { useEffect, useState } from 'react'
import { isMac } from '../utils/platform'

const REVEAL_DELAY_MS = 250

function isCommandKey(event: KeyboardEvent): boolean {
  return isMac() ? event.key === 'Meta' : event.key === 'Control'
}

/** True once the platform command key (⌘ / Ctrl) has been held for a short moment. */
export function useCommandKeyHeld(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clear = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const release = () => {
      clear()
      setHeld(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandKey(event)) {
        if (!timer && !event.repeat) timer = setTimeout(() => setHeld(true), REVEAL_DELAY_MS)
        return
      }
      // Another key pressed with the modifier: the user is executing a shortcut.
      release()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (isCommandKey(event)) release()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', release)
    return () => {
      release()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', release)
    }
  }, [])

  return held
}
