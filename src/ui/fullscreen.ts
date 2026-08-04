/**
 * Go fullscreen on phones and tablets when the player taps.
 *
 * A portal serves the game in an iframe with the site's chrome around it, and on
 * a phone that chrome plus the browser's own address bar eats a third of a
 * screen that was small to begin with — on a game whose UI is anchored to the
 * viewport corners. Fullscreen buys all of it back.
 *
 * Three things make this awkward enough to be worth its own file:
 *
 *  - **It has to be a user gesture.** Browsers reject `requestFullscreen` from
 *    load, from a timer, or from anything the user did not initiate, so the
 *    request rides a real touch/click.
 *  - **It must not eat that touch.** Listeners are passive and use capture so
 *    the same tap still plants a seed even if something stops bubbling.
 *  - **Failure is normal.** iOS Safari has no Element.requestFullscreen at all,
 *    and an iframe without `allowfullscreen` refuses. Both reject rather than
 *    throw synchronously. We keep listening until fullscreen actually sticks
 *    (or the API is missing), so a failed first tap is not the end of it.
 *
 * Once the player has been in fullscreen and left, we stop asking — dragging
 * them back in on every tap is hostile.
 */

/** Vendor-prefixed shapes that still exist on shipping mobile browsers. */
interface FullscreenCapable extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
  mozRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

interface FullscreenDoc extends Document {
  webkitFullscreenElement?: Element | null
  mozFullScreenElement?: Element | null
  msFullscreenElement?: Element | null
}

/** Phone or tablet: coarse pointer, no hover. Desktop touchscreens fail this. */
export function isHandheld() {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(hover: none) and (pointer: coarse)').matches
  )
}

function isTouchCapable() {
  return (
    isHandheld() ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  )
}

function alreadyFullscreen() {
  const doc = document as FullscreenDoc
  return Boolean(
    doc.fullscreenElement ??
      doc.webkitFullscreenElement ??
      doc.mozFullScreenElement ??
      doc.msFullscreenElement,
  )
}

function requestFs(root: FullscreenCapable): Promise<void> | void | undefined {
  if (root.requestFullscreen) return root.requestFullscreen({ navigationUI: 'hide' })
  if (root.webkitRequestFullscreen) return root.webkitRequestFullscreen()
  if (root.webkitRequestFullScreen) return root.webkitRequestFullScreen()
  if (root.mozRequestFullScreen) return root.mozRequestFullScreen()
  if (root.msRequestFullscreen) return root.msRequestFullscreen()
  return undefined
}

function hasFullscreenApi(root: FullscreenCapable) {
  return Boolean(
    root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      root.webkitRequestFullScreen ||
      root.mozRequestFullScreen ||
      root.msRequestFullscreen,
  )
}

export function enableAutoFullscreen() {
  if (!isTouchCapable()) return

  const root = document.documentElement as FullscreenCapable
  if (!hasFullscreenApi(root)) return

  let finished = false
  let busy = false

  const cleanup = () => {
    if (finished) return
    finished = true
    removeEventListener('pointerdown', onPointer, true)
    removeEventListener('touchend', onTouchEnd, true)
    removeEventListener('click', onClick, true)
    document.removeEventListener('fullscreenchange', onFsChange)
    document.removeEventListener('webkitfullscreenchange', onFsChange)
  }

  const onFsChange = () => {
    if (alreadyFullscreen()) cleanup()
  }

  const attempt = () => {
    if (finished || busy) return
    if (alreadyFullscreen()) {
      cleanup()
      return
    }

    busy = true
    try {
      const result = requestFs(root)
      void Promise.resolve(result)
        .then(() => {
          busy = false
          if (alreadyFullscreen()) {
            const orientation = screen.orientation as ScreenOrientation & {
              lock?: (o: string) => Promise<void>
            }
            void orientation?.lock?.('landscape').catch(() => {})
            cleanup()
          }
        })
        .catch(() => {
          // Still not fullscreen — try again on the next tap.
          busy = false
        })
    } catch {
      busy = false
    }
  }

  const onPointer = (e: Event) => {
    const pe = e as PointerEvent
    // Desktop mouse with a touchscreen attached should not force fullscreen.
    if (pe.pointerType === 'mouse' && !isHandheld()) return
    attempt()
  }

  const onTouchEnd = () => attempt()

  const onClick = () => {
    // Some Android WebViews only honour fullscreen from `click`.
    if (!isHandheld()) return
    attempt()
  }

  document.addEventListener('fullscreenchange', onFsChange)
  document.addEventListener('webkitfullscreenchange', onFsChange)
  // Capture so a stopPropagation on the canvas/UI cannot miss the gesture.
  addEventListener('pointerdown', onPointer, { passive: true, capture: true })
  addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
  addEventListener('click', onClick, { passive: true, capture: true })
}
