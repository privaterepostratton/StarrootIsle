const held = new Set<string>()
let touchX = 0
let touchY = 0
const pressedThisFrame = new Set<string>()

addEventListener('keydown', (e) => {
  const code = e.code
  if (!held.has(code)) pressedThisFrame.add(code)
  held.add(code)
  // Stop space/arrows from scrolling the page behind the canvas.
  if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault()
})

addEventListener('keyup', (e) => held.delete(e.code))

// A focus loss never fires keyup, which would leave the player sprinting
// into a fence forever.
addEventListener('blur', () => held.clear())

export const Input = {
  isDown(code: string) {
    return held.has(code)
  },

  /** True only on the frame the key went down. */
  justPressed(code: string) {
    return pressedThisFrame.has(code)
  },

  /** Movement axes, already normalised. x = strafe, y = forward. */
  moveAxis() {
    let x = touchX
    let y = touchY
    if (held.has('KeyW') || held.has('ArrowUp')) y += 1
    if (held.has('KeyS') || held.has('ArrowDown')) y -= 1
    if (held.has('KeyD') || held.has('ArrowRight')) x += 1
    if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    return { x, y, len: Math.min(len, 1) }
  },

  /**
   * Analogue axis from the touch joystick, merged into moveAxis above so the
   * whole game keeps a single movement input path. Sub-1 magnitudes survive
   * the merge, so a light thumb genuinely walks slower.
   */
  setTouchAxis(x: number, y: number) {
    touchX = x
    touchY = y
  },

  /** Call once at the end of every frame. */
  endFrame() {
    pressedThisFrame.clear()
  },

  /** Drop held keys — used when a modal opens so the player stops walking. */
  clear() {
    held.clear()
    pressedThisFrame.clear()
  },
}
