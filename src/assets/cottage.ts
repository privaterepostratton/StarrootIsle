import * as THREE from 'three'
import { block } from './style'
import { getModels, modelGroup, fitToHeight, PROP_HEIGHT } from './models'

/**
 * Mailbox marking whose farm this is. The flag is raised when the neighbour
 * has a gift waiting, which is the pull that gets the player to walk over.
 */
export interface Mailbox {
  object: THREE.Group
  setFlag(up: boolean): void
}

const MAILBOX_HEIGHT = PROP_HEIGHT.mailbox

/**
 * Mailbox: authored body, procedural flag.
 *
 * The flag is not decoration — it is the game's signal that a friendship gift is
 * waiting, and it has to move. A single-mesh glTF cannot articulate, so the body
 * comes from the model and the flag stays a separate pivoted mesh mounted on it.
 * That keeps `setFlag` working and keeps the one moving part under our control.
 */
export function createMailboxModel(accent: number): Mailbox {
  const g = new THREE.Group()

  const model = getModels().mailbox
  const body = modelGroup(model, MAILBOX_HEIGHT)
  g.add(body)

  /*
   * The flag mounts on the model's own measured flank, not on a literal.
   *
   * `(0.19, …, -0.06)` was tuned by eye against the mailbox that shipped first,
   * and the replacement is a different shape — narrower across and half again as
   * deep. A hand-tuned offset survives exactly one of those swaps: the flag ends
   * up hovering beside the box, or buried inside it, and the failure is silent
   * because the flag is only raised when a gift is waiting.
   *
   * Measuring puts it against whichever flank the model actually has. The 0.92
   * pulls it just inside the silhouette so it reads as mounted rather than as
   * floating alongside.
   */
  const box = model.geometry.boundingBox!
  const scale = fitToHeight(model, MAILBOX_HEIGHT).scale
  const flank = box.max.x * scale * 0.92

  const flagPivot = new THREE.Group()
  // On the flank, near the top of the post where the box itself sits.
  flagPivot.position.set(flank, MAILBOX_HEIGHT * 0.72, 0)
  g.add(flagPivot)

  const flag = block(0.05, 0.26, 0.14, accent, 0.02)
  flag.position.y = 0.15
  flagPivot.add(flag)

  // Down = nothing waiting, up = a gift. Rotating the pivot rather than
  // toggling visibility keeps the transition readable if it is ever animated.
  flagPivot.rotation.z = Math.PI / 2

  return {
    object: g,
    setFlag(up: boolean) {
      flagPivot.rotation.z = up ? 0 : Math.PI / 2
    },
  }
}
