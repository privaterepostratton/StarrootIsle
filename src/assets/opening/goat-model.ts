import * as THREE from 'three'
import { mat, ball, cyl } from '../style'

/**
 * The island goat — the hero asset of the whole opening.
 *
 * Built in the procedural box-rig school (animal.ts livestock, critters.ts
 * crabs): chunky Animal Crossing proportions, cached lambert materials, no
 * GLB, no mixer. Every part that acts is a Group with its pivot at the joint,
 * so goat.ts can swing legs, dip the head and flick the tail with plain
 * transform writes.
 *
 * Design intent, per the spec's fauna manifest: a SMALL island goat — cream
 * coat, ONE sea-foam swirl marking on the flank (the generative-texture
 * teaser; exactly one, always the same flank), small back-swept horns, big
 * expressive ears. The single most important thing this rig does is
 * `lookAt`: the beat-9 "being seen" moment is one second of the goat's head
 * and ears locked on the player, so head tracking + ear engagement live here
 * in the rig where they can be smoothed consistently no matter which phase
 * is driving.
 *
 * Colour discipline: everything desaturated-warm (the postfx grade multiplies
 * saturation 1.2). Nothing here approaches lotto gold 0xf2c14e.
 */

export interface GoatRig {
  root: THREE.Group
  head: THREE.Group
  body: THREE.Group
  legs: THREE.Group[]
  ears: THREE.Group[]
  tail: THREE.Group
  /** Head + ears track the point; null releases back to rest. Call per frame. */
  lookAt(worldPos: THREE.Vector3 | null): void
}

/** Cream coat — the spec's colour, slightly warm, never white. */
const COAT = 0xf1e9d8
/** Muzzle / beard / underside shade — a step darker so the face reads. */
const COAT_SHADE = 0xe3d7bf
/** THE sea-foam swirl. One marking, one flank, nowhere else on the animal. */
const SWIRL = 0x9fd8cf
/** Small horns: dry bone, not gold, not shiny. */
const HORN = 0xcfc2a8
/** Hooves and nose lean dark-brown, matching the volcanic-soil palette. */
const HOOF = 0x4a4038
const NOSE = 0x5a4a40
const INNER_EAR = 0xd8b6a4
const EYE = 0x2b2620

/** Body group rest height — legs are tuned so hooves land at y≈0. */
export const GOAT_BODY_Y = 0.49

/** How far the head will turn to track (radians). Past this the goat would
 *  need to move its body, which is the animator's job, not the rig's. */
const YAW_LIMIT = 1.15
const PITCH_UP_LIMIT = 0.6
/** Generous downward reach: sniffing and eating pose through lookAt too. */
const PITCH_DOWN_LIMIT = 0.95
/** Per-call blend toward the look target (rig is driven at frame rate). */
const TRACK_BLEND = 0.18

function goatLeg(): THREE.Group {
  const joint = new THREE.Group()
  const upper = cyl(0.035, 0.042, 0.26, COAT, 6)
  upper.position.y = -0.12
  joint.add(upper)
  const hoof = cyl(0.038, 0.043, 0.075, HOOF, 6)
  hoof.position.y = -0.285
  joint.add(hoof)
  return joint
}

export function createGoatModel(): GoatRig {
  const root = new THREE.Group()

  const body = new THREE.Group()
  body.position.y = GOAT_BODY_Y
  root.add(body)

  // --- torso mass: overlapping lumps, the sheep lesson — one smooth ball
  // reads as a pill; a cluster reads as an animal.
  const torso = ball(0.26, COAT, 1)
  torso.scale.set(0.95, 0.9, 1.5)
  body.add(torso)

  const chest = ball(0.16, COAT, 1)
  chest.scale.set(0.9, 0.95, 0.85)
  chest.position.set(0, -0.03, 0.3)
  body.add(chest)

  const withers = ball(0.13, COAT, 1)
  withers.scale.set(1, 0.8, 1.1)
  withers.position.set(0, 0.12, 0.12)
  body.add(withers)

  for (const sx of [-1, 1]) {
    const haunch = ball(0.15, COAT, 1)
    haunch.position.set(sx * 0.09, 0.02, -0.27)
    body.add(haunch)
  }

  /*
   * THE swirl — one sea-foam curl on the right flank. A spiral of shrinking
   * discs (the cow-patch precedent: half-buried balls read as hand-painted
   * markings at this scale). Thick enough along x to straddle the torso's
   * curved surface at every point of the arc, so nothing floats.
   */
  const swirl = new THREE.Group()
  const arc: { a: number; r: number; s: number }[] = [
    { a: -0.6, r: 0.115, s: 0.07 },
    { a: 0.55, r: 0.105, s: 0.062 },
    { a: 1.7, r: 0.085, s: 0.054 },
    { a: 2.85, r: 0.06, s: 0.045 },
    { a: 3.9, r: 0.032, s: 0.036 },
  ]
  for (const { a, r, s } of arc) {
    const fleck = ball(s, SWIRL, 1)
    fleck.scale.x = 0.4
    fleck.position.set(0, Math.sin(a) * r, Math.cos(a) * r)
    swirl.add(fleck)
  }
  swirl.position.set(0.235, 0.03, -0.06)
  body.add(swirl)

  // --- neck + head
  const neck = cyl(0.085, 0.115, 0.3, COAT, 8)
  neck.position.set(0, 0.22, 0.33)
  neck.rotation.x = 0.5
  body.add(neck)

  const head = new THREE.Group()
  head.position.set(0, 0.4, 0.46)
  body.add(head)

  const skull = ball(0.135, COAT, 1)
  skull.scale.set(0.88, 0.95, 1.05)
  head.add(skull)

  const fringe = ball(0.07, COAT, 1)
  fringe.scale.set(1.1, 0.6, 0.9)
  fringe.position.set(0, 0.1, 0.04)
  head.add(fringe)

  const muzzle = ball(0.085, COAT_SHADE, 1)
  muzzle.scale.set(0.82, 0.72, 1.05)
  muzzle.position.set(0, -0.045, 0.115)
  head.add(muzzle)

  const nose = ball(0.024, NOSE, 1)
  nose.position.set(0, -0.02, 0.2)
  head.add(nose)

  // Goat beard: the one silhouette cue nothing else in the pasture has.
  const beard = ball(0.035, COAT_SHADE, 1)
  beard.scale.set(0.7, 1.7, 0.7)
  beard.position.set(0, -0.125, 0.07)
  head.add(beard)

  // Eyes with a glint — the hero gets catchlights; livestock does not.
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(EYE))
    eye.scale.set(0.034, 0.042, 0.017)
    eye.position.set(sx * 0.082, 0.02, 0.095)
    head.add(eye)
    const glint = ball(0.011, 0xf7f3ea, 1)
    glint.position.set(sx * 0.089, 0.033, 0.106)
    head.add(glint)
  }

  // Small horns, swept back — a kid's nubs grown just past cute.
  for (const sx of [-1, 1]) {
    const hornG = new THREE.Group()
    hornG.position.set(sx * 0.05, 0.115, -0.03)
    hornG.rotation.x = -0.55
    hornG.rotation.z = sx * 0.18
    const base = cyl(0.02, 0.032, 0.09, HORN, 6)
    base.position.y = 0.04
    hornG.add(base)
    const tip = cyl(0.006, 0.018, 0.08, HORN, 6)
    tip.position.set(0, 0.1, -0.02)
    tip.rotation.x = -0.45
    hornG.add(tip)
    head.add(hornG)
  }

  // Ears: pivot at the skull so engagement (droop → perked-forward) is a
  // rotation write. Rest pose is the sleepy sideways droop; lookAt raises them.
  const ears: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    const earG = new THREE.Group()
    earG.position.set(sx * 0.115, 0.07, -0.005)
    const outer = ball(0.055, COAT, 1)
    outer.scale.set(1.75, 0.55, 0.8)
    outer.position.set(sx * 0.085, 0, 0)
    earG.add(outer)
    const inner = ball(0.032, INNER_EAR, 1)
    inner.scale.set(1.5, 0.4, 0.6)
    inner.position.set(sx * 0.08, 0.012, 0.02)
    earG.add(inner)
    earG.rotation.z = -sx * 0.5
    head.add(earG)
    ears.push(earG)
  }

  // --- legs: [FL, FR, RL, RR], pivots at the hips.
  const legs: THREE.Group[] = []
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const l = goatLeg()
      l.position.set(sx * 0.135, -0.16, sz * 0.26)
      body.add(l)
      legs.push(l)
    }
  }

  // --- tail: a perky up-flick tuft, pivot at the rump.
  const tail = new THREE.Group()
  tail.position.set(0, 0.14, -0.38)
  tail.rotation.x = -0.35
  const tuft = ball(0.05, COAT, 1)
  tuft.scale.set(0.75, 1.25, 0.7)
  tuft.position.set(0, 0.05, -0.015)
  tail.add(tuft)
  body.add(tail)

  // --- head/ear tracking -----------------------------------------------------
  let curYaw = 0
  let curPitch = 0
  let curEngage = 0
  const tmp = new THREE.Vector3()

  function lookAt(worldPos: THREE.Vector3 | null): void {
    let tYaw = 0
    let tPitch = 0
    let tEngage = 0
    if (worldPos) {
      // Matrices may be a frame stale mid-update; refresh the chain so the
      // look lands where the goat IS, not where it was.
      body.updateWorldMatrix(true, false)
      tmp.copy(worldPos)
      body.worldToLocal(tmp)
      tmp.sub(head.position)
      const flat = Math.hypot(tmp.x, tmp.z)
      tYaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -YAW_LIMIT, YAW_LIMIT)
      tPitch = THREE.MathUtils.clamp(Math.atan2(tmp.y, flat), -PITCH_DOWN_LIMIT, PITCH_UP_LIMIT)
      tEngage = 1
    }
    curYaw += (tYaw - curYaw) * TRACK_BLEND
    curPitch += (tPitch - curPitch) * TRACK_BLEND
    curEngage += (tEngage - curEngage) * TRACK_BLEND
    head.rotation.set(curPitch, curYaw, 0)
    // Engagement pulls the ears from sideways droop to perked-forward — the
    // spec's "ears forward" is this number reaching 1 during the look beat.
    for (let i = 0; i < ears.length; i++) {
      const sx = i === 0 ? -1 : 1
      ears[i].rotation.z = -sx * (0.5 - 0.36 * curEngage)
      ears[i].rotation.y = sx * -0.45 * curEngage
    }
  }

  return { root, head, body, legs, ears, tail, lookAt }
}
