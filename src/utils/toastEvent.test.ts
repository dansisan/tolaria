import { describe, expect, it, vi } from 'vitest'
import { TOAST_EVENT, requestToast, subscribeToToasts } from './toastEvent'

describe('toastEvent', () => {
  it('delivers a requested message to the subscriber', () => {
    const onToast = vi.fn()
    const unsubscribe = subscribeToToasts(onToast)

    requestToast('Filename unchanged')

    expect(onToast).toHaveBeenCalledWith('Filename unchanged')
    unsubscribe()
  })

  it('stops delivering after unsubscribe', () => {
    const onToast = vi.fn()
    subscribeToToasts(onToast)()

    requestToast('Ignored')

    expect(onToast).not.toHaveBeenCalled()
  })

  /** A blank toast would render an empty bar, so treat it as nothing to show. */
  it('ignores events without a usable string payload', () => {
    const onToast = vi.fn()
    const unsubscribe = subscribeToToasts(onToast)

    for (const detail of ['', null, undefined, 42, { message: 'nope' }]) {
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }))
    }

    expect(onToast).not.toHaveBeenCalled()
    unsubscribe()
  })
})
