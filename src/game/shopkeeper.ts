import * as THREE from 'three'
import { getShopkeeperModel, type ShopkeeperModel } from '../assets/models'
import { groundHeight } from './terrain'

/**
 * The stallholder who stands beside the seed stall.
 *
 * The stall was a building the player walked up to and pressed a key at. A
 * person standing behind it is the cheapest way to make it read as a *shop* —
 * and the wave does the work a marker cannot: it acknowledges you, so arriving
 * has a beat to it rather than being a silent proximity check.
 *
 * Two clips, layered by rules rather than by a state machine, because there are
 * only two states and one transition worth naming:
 *
 *  - idle loops forever
 *  - wave plays once when someone arrives, then hands back to idle
 *
 * The greeting fires on *arrival*, not on proximity. Waving every frame the
 * player stands at the counter would be a twitch; waving once as they walk up,
 * and again only after they have been away, is a greeting.
 */

/** Close enough to be greeted. */
const GREET_RANGE = 5.5
/** Has to get this far away before they are a new arrival again. */
const LEAVE_RANGE = 8
/** Floor between waves, so pacing back and forth over the line is not a rave. */
const COOLDOWN = 12
/** Cross-fade between the two clips. */
const FADE = 0.25

export class Shopkeeper {
  readonly object: THREE.Object3D

  private readonly mixer: THREE.AnimationMixer
  private readonly idle: THREE.AnimationAction | null
  private readonly wave: THREE.AnimationAction | null

  /** True while the player is inside GREET_RANGE — the arrival edge. */
  private near = false
  private cooldown = 0
  /** Counts down while the wave is playing, so idle resumes on its own. */
  private waving = 0

  /**
   * The greeting's voice.
   *
   * Fired from inside `greet()` rather than from the caller so it cannot get out
   * of step with the animation: the cooldown and the missing-clip case both bail
   * out before this point, and a "hello" from someone who is not waving is worse
   * than silence.
   */
  onGreet: (() => void) | null = null

  /**
   * `model` defaults to the shopkeeper's, because this class was that character
   * before it was a behaviour. Every villager who stands in one place and waves
   * at an arriving player wants exactly this — the hysteresis, the cooldown, the
   * clip cross-fade — so the character is a parameter rather than a copy.
   */
  constructor(position: THREE.Vector3, facing: number, model: ShopkeeperModel = getShopkeeperModel()) {
    this.object = model.root
    this.object.position.set(position.x, groundHeight(position.x, position.z), position.z)
    this.object.rotation.y = facing

    this.mixer = new THREE.AnimationMixer(this.object)
    this.idle = model.idle ? this.mixer.clipAction(model.idle) : null
    this.wave = model.wave ? this.mixer.clipAction(model.wave) : null

    if (this.wave) {
      // Once through, and hold the last frame rather than snapping back to bind
      // pose — the cross-fade to idle covers the return.
      this.wave.setLoop(THREE.LoopOnce, 1)
      this.wave.clampWhenFinished = true
    }
    this.idle?.play()
  }

  /** Play the greeting now, whatever the distance rules say. */
  greet() {
    if (!this.wave || this.cooldown > 0) return
    this.cooldown = COOLDOWN
    this.waving = this.wave.getClip().duration
    this.wave.reset().setEffectiveWeight(1).fadeIn(FADE).play()
    this.idle?.fadeOut(FADE)
    this.onGreet?.()
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.cooldown = Math.max(0, this.cooldown - dt)

    const dist = Math.hypot(playerPos.x - this.object.position.x, playerPos.z - this.object.position.z)
    /*
     * Hysteresis, not a single threshold. With one distance the player standing
     * exactly on the line flickers in and out of range every frame the camera
     * breathes, and each crossing is another wave.
     */
    if (!this.near && dist < GREET_RANGE) {
      this.near = true
      this.greet()
    } else if (this.near && dist > LEAVE_RANGE) {
      this.near = false
    }

    if (this.waving > 0) {
      this.waving -= dt
      if (this.waving <= 0) {
        this.idle?.reset().fadeIn(FADE).play()
        this.wave?.fadeOut(FADE)
      }
    }

    // Animated only when someone could see it. Idling a 24-bone skeleton across
    // the map costs a skin upload a frame for a figure nobody is looking at.
    if (dist < 42) this.mixer.update(dt)
  }
}
