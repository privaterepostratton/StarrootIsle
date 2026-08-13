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
 * teaser; exactly one, always the same flank), back-swept horns, big
 * expressive ears. The single most important thing this rig does is
 * `lookAt`: the beat-9 "being seen" moment is one second of the goat's head
 * and ears locked on the player, so head tracking + ear engagement live here
 * in the rig where they can be smoothed consistently no matter which phase
 * is driving.
 *
 * What the first pass got wrong, and what fixed it
 * ------------------------------------------------
 * It photographed as a capsule on four white tubes. Three things did that, and
 * all three are structural rather than a matter of tuning:
 *
 *   1. **The torso was smooth.** A goat is bony — hips, withers, ribs, a
 *      shaggy skirt hanging off the belly line. A single ellipsoid has no
 *      landmarks, so the eye reads "pill" and stops. The coat here is a shell
 *      of overlapping fleece lumps at two tones, which breaks the outline
 *      everywhere it matters and gives the low dawn key something to rake
 *      across.
 *   2. **The legs did not taper.** Untapered cylinders of the body colour are
 *      furniture legs. A real goat's leg is a wide woolly thigh over a thin
 *      dark cannon over a black hoof — three values in a hand's width, and
 *      that value ladder is most of what makes the animal read at fifteen
 *      metres.
 *   3. **The marking was a cluster of circles**, which contradicted the goat
 *      sketch the player is handed in the same session. It is now a proper
 *      spiral: radius and disc size both grow along the arc, so it curls.
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
const COAT_SHADE = 0xdccfb4
/** The deepest coat value: belly, throat, the shadow side of the fleece. It is
 *  only ~12% down from COAT, but on a cream animal that is the whole of the
 *  modelling — go further and the goat looks dirty rather than furry. */
const COAT_DEEP = 0xc4b79c
/** THE sea-foam swirl. One marking, one flank, nowhere else on the animal. */
const SWIRL = 0x9fd8cf
/** The swirl's own shadow tone, so the spiral has depth rather than reading
 *  as a sticker. */
const SWIRL_DEEP = 0x7cbdb4
/** Horns: dry bone, not gold, not shiny. */
const HORN = 0xc9bca2
const HORN_DARK = 0xa4967c
/** Hooves and nose lean dark-brown, matching the volcanic-soil palette. */
const HOOF = 0x3b332c
/** The cannon bone between woolly thigh and hoof — the middle value. */
const SHIN = 0x9b8f7c
const NOSE = 0x5a4a40
const INNER_EAR = 0xd8b6a4
const EYE = 0x241f1a
const EYE_WHITE = 0xf6f1e6

/** Body group rest height — legs are tuned so hooves land at y≈0. */
export const GOAT_BODY_Y = 0.52

/** How far the head will turn to track (radians). Past this the goat would
 *  need to move its body, which is the animator's job, not the rig's. */
const YAW_LIMIT = 1.15
const PITCH_UP_LIMIT = 0.6
/** Generous downward reach: sniffing and eating pose through lookAt too. */
const PITCH_DOWN_LIMIT = 0.95
/** Per-call blend toward the look target (rig is driven at frame rate). */
const TRACK_BLEND = 0.18

/**
 * One leg: woolly thigh → thin dark cannon → hoof, all under a hip pivot.
 *
 * The taper is deliberate and steep (0.075 at the top, 0.028 at the ankle).
 * Anything gentler and the leg is a dowel; this profile is what makes the
 * animal look like it is standing on bone rather than propped on posts.
 */
function goatLeg(front: boolean): THREE.Group {
  const joint = new THREE.Group()

  // Woolly upper: shoulder or haunch mass carried down onto the leg, so the
  // limb grows out of the body instead of being plugged into it.
  const thigh = cyl(0.055, 0.078, 0.16, COAT, 7)
  thigh.position.y = -0.06
  joint.add(thigh)
  const fluff = ball(0.075, front ? COAT : COAT_SHADE, 1)
  fluff.scale.set(1, 0.9, 1.1)
  fluff.position.y = -0.02
  joint.add(fluff)

  // Knee, then the thin cannon bone. The knee bump is one mesh and it is what
  // stops the two segments reading as one broken cylinder.
  const knee = ball(0.042, COAT_SHADE, 1)
  knee.position.y = -0.16
  joint.add(knee)

  const cannon = cyl(0.028, 0.036, 0.19, SHIN, 6)
  cannon.position.y = -0.255
  joint.add(cannon)

  // Hoof: dark, and slightly flared at the base so it plants.
  const hoof = cyl(0.043, 0.036, 0.06, HOOF, 6)
  hoof.position.y = -0.375
  joint.add(hoof)
  const cleft = ball(0.03, 0x2a251f, 0)
  cleft.scale.set(0.8, 0.5, 1.1)
  cleft.position.set(0, -0.4, 0.012)
  joint.add(cleft)

  return joint
}

export function createGoatModel(): GoatRig {
  const root = new THREE.Group()

  const body = new THREE.Group()
  body.position.y = GOAT_BODY_Y
  root.add(body)

  // --- torso mass: overlapping lumps, the sheep lesson — one smooth ball
  // reads as a pill; a cluster reads as an animal.
  const torso = ball(0.27, COAT, 1)
  torso.scale.set(0.94, 0.88, 1.5)
  body.add(torso)

  const chest = ball(0.17, COAT, 1)
  chest.scale.set(0.92, 0.98, 0.88)
  chest.position.set(0, -0.03, 0.31)
  body.add(chest)

  // Withers and rump: the two bony landmarks along the topline. Raising them
  // above the barrel is what gives the back its dip — the single most
  // goat-shaped line on the animal.
  const withers = ball(0.135, COAT, 1)
  withers.scale.set(0.95, 0.85, 1.05)
  withers.position.set(0, 0.135, 0.14)
  body.add(withers)

  const rump = ball(0.15, COAT, 1)
  rump.scale.set(1, 0.95, 1)
  rump.position.set(0, 0.115, -0.26)
  body.add(rump)

  for (const sx of [-1, 1]) {
    const haunch = ball(0.155, COAT_SHADE, 1)
    haunch.scale.set(0.9, 1, 1.05)
    haunch.position.set(sx * 0.1, 0.0, -0.27)
    body.add(haunch)
  }

  /*
   * The fleece shell.
   *
   * Twelve lumps hung round the barrel at two tones, weighted low along the
   * belly line where a goat's coat actually hangs in a skirt. They are not
   * detail — they are the silhouette: this ring of overlapping bumps is what
   * turns the ellipsoid underneath into something with a coat on it, and it is
   * the difference the reviewer was asking for when they said "no fur".
   */
  const fleece: { a: number; z: number; y: number; s: number; deep: boolean }[] = [
    { a: 0.5, z: 0.16, y: -0.06, s: 0.1, deep: false },
    { a: 1.1, z: -0.02, y: -0.11, s: 0.11, deep: true },
    { a: 1.9, z: -0.2, y: -0.05, s: 0.09, deep: false },
    { a: 2.7, z: 0.05, y: -0.13, s: 0.1, deep: true },
    { a: 3.5, z: 0.2, y: -0.04, s: 0.09, deep: false },
    { a: 4.2, z: -0.14, y: -0.12, s: 0.11, deep: true },
    { a: 5.0, z: 0.02, y: -0.06, s: 0.1, deep: false },
    { a: 5.7, z: -0.24, y: -0.1, s: 0.09, deep: true },
  ]
  for (const f of fleece) {
    const lump = ball(f.s, f.deep ? COAT_DEEP : COAT, 1)
    lump.scale.set(1, 0.8, 1.25)
    lump.position.set(Math.cos(f.a) * 0.21, f.y + Math.sin(f.a) * 0.07, f.z)
    body.add(lump)
  }

  // Belly: one long deep-tone mass under the barrel. Undersides in shadow are
  // how a stylised animal gets weight without a single extra light.
  const belly = ball(0.2, COAT_DEEP, 1)
  belly.scale.set(0.95, 0.62, 1.5)
  belly.position.set(0, -0.16, 0.02)
  body.add(belly)

  /*
   * THE swirl — one sea-foam curl on the right flank.
   *
   * A true spiral: both the arc radius and the disc size grow along it, so it
   * reads as something coiling outward rather than as a cluster of dots. This
   * has to match the goat sketched on the journal page in the same session —
   * the player is being told these two are the same animal, and a marking that
   * disagrees with its own drawing quietly breaks that.
   *
   * Built from half-buried discs squashed flat against the flank (the cow-patch
   * precedent), with the outer half in the deeper foam tone so the curl has a
   * light and a shadow side.
   */
  const swirl = new THREE.Group()
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    const a = -0.5 + t * 4.6
    const rad = 0.02 + t * 0.135
    const size = 0.062 - t * 0.026
    const fleck = ball(size, i > 4 ? SWIRL_DEEP : SWIRL, 1)
    // Squashed hard along the flank normal so it lies ON the coat, and pushed
    // just proud of the torso surface so nothing z-fights the fleece.
    fleck.scale.set(0.32, 1, 1)
    fleck.position.set(0, Math.sin(a) * rad, Math.cos(a) * rad)
    swirl.add(fleck)
  }
  swirl.position.set(0.235, 0.02, -0.04)
  body.add(swirl)

  // --- neck + head
  const neck = cyl(0.09, 0.125, 0.32, COAT, 8)
  neck.position.set(0, 0.24, 0.34)
  neck.rotation.x = 0.5
  body.add(neck)
  // Throat ruff — the coat breaking over the neck join.
  const ruff = ball(0.11, COAT_SHADE, 1)
  ruff.scale.set(0.95, 0.8, 0.9)
  ruff.position.set(0, 0.15, 0.36)
  body.add(ruff)

  const head = new THREE.Group()
  head.position.set(0, 0.43, 0.48)
  body.add(head)

  const skull = ball(0.14, COAT, 1)
  skull.scale.set(0.88, 0.95, 1.05)
  head.add(skull)

  // Brow ridge: the flat forehead plate a goat has between the horns, and the
  // shelf the eyes sit under.
  const brow = ball(0.085, COAT, 1)
  brow.scale.set(1.15, 0.55, 0.85)
  brow.position.set(0, 0.085, 0.045)
  head.add(brow)

  const muzzle = ball(0.088, COAT_SHADE, 1)
  muzzle.scale.set(0.84, 0.74, 1.1)
  muzzle.position.set(0, -0.05, 0.125)
  head.add(muzzle)

  const nose = ball(0.028, NOSE, 1)
  nose.scale.set(1.2, 0.8, 0.9)
  nose.position.set(0, -0.025, 0.208)
  head.add(nose)

  // Goat beard: the one silhouette cue nothing else in the pasture has.
  const beard = ball(0.038, COAT_SHADE, 1)
  beard.scale.set(0.7, 1.8, 0.7)
  beard.position.set(0, -0.135, 0.075)
  head.add(beard)

  /*
   * Eyes.
   *
   * Big, and built in three layers — cream white, dark pupil, catchlight —
   * because the whole beat-9 payoff is one second of eye contact, and an eye
   * that is a single dark dot cannot make contact: it has no direction. The
   * white is what tells the player which way the goat is looking, and the
   * glint is what makes it alive rather than glass.
   */
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat(EYE_WHITE))
    white.scale.set(0.06, 0.062, 0.03)
    white.position.set(sx * 0.088, 0.025, 0.09)
    white.rotation.y = sx * 0.35
    head.add(white)

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(EYE))
    // Horizontal, the way a goat's pupil actually is — and it happens to read
    // as a decisive, forward stare at any size.
    pupil.scale.set(0.042, 0.026, 0.03)
    pupil.position.set(sx * 0.093, 0.023, 0.104)
    pupil.rotation.y = sx * 0.35
    head.add(pupil)

    const glint = ball(0.012, 0xfffdf6, 1)
    glint.position.set(sx * 0.096, 0.04, 0.112)
    head.add(glint)
  }

  /*
   * Horns: back-swept, four tapering segments each, following an arc.
   *
   * The first pass used two stubby cylinders and they vanished into the skull
   * at any distance. A horn is a silhouette organ — it exists to be seen
   * against the sky above the head — so these are longer, thicker at the base,
   * and they curve, which is the only way a horn reads as horn rather than as
   * a spike.
   */
  for (const sx of [-1, 1]) {
    const hornG = new THREE.Group()
    hornG.position.set(sx * 0.058, 0.115, -0.01)
    hornG.rotation.z = sx * 0.22
    head.add(hornG)

    /*
     * Segments advance by only 78% of their own length, so consecutive pieces
     * overlap and the horn is one continuous tapering curve. Advancing by the
     * full length leaves a hairline gap at every bend, and three gaps turn a
     * horn into three sticks hovering over the goat's head.
     */
    let y = 0
    let z = 0
    let pitch = -0.24
    for (let i = 0; i < 4; i++) {
      const len = 0.085 - i * 0.008
      const seg = cyl(0.023 - i * 0.005, 0.032 - i * 0.005, len, i > 1 ? HORN_DARK : HORN, 6)
      seg.position.set(0, y + Math.cos(pitch) * len * 0.5, z + Math.sin(pitch) * len * 0.5)
      seg.rotation.x = -pitch
      hornG.add(seg)
      // One growth collar at each bend, flattened along the horn's axis.
      const ring = ball(0.03 - i * 0.005, HORN_DARK, 0)
      ring.scale.set(1, 0.3, 1)
      ring.position.set(0, y, z)
      ring.rotation.x = -pitch
      hornG.add(ring)

      y += Math.cos(pitch) * len * 0.78
      z += Math.sin(pitch) * len * 0.78
      pitch -= 0.3
    }
  }

  /*
   * Ears: big, and held out sideways where they break the head's outline.
   *
   * Pivot at the skull so engagement (droop → perked-forward) is a rotation
   * write. Rest pose is the sleepy sideways droop; lookAt raises them, and the
   * spec's "ears forward" is entirely this rotation reaching its target.
   */
  const ears: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    const earG = new THREE.Group()
    earG.position.set(sx * 0.11, 0.06, -0.01)

    const outer = ball(0.062, COAT, 1)
    outer.scale.set(2.1, 0.5, 0.95)
    outer.position.set(sx * 0.115, 0, 0)
    earG.add(outer)

    // A second, smaller lump at the tip keeps the ear from ending in a blunt
    // ellipse — goat ears taper and flick down at the end.
    const tip = ball(0.04, COAT_SHADE, 1)
    tip.scale.set(1.5, 0.45, 0.8)
    tip.position.set(sx * 0.215, -0.012, -0.005)
    earG.add(tip)

    const inner = ball(0.036, INNER_EAR, 1)
    inner.scale.set(1.7, 0.36, 0.62)
    inner.position.set(sx * 0.108, 0.014, 0.018)
    earG.add(inner)

    earG.rotation.z = -sx * 0.5
    head.add(earG)
    ears.push(earG)
  }

  // --- legs: [FL, FR, RL, RR], pivots at the hips.
  const legs: THREE.Group[] = []
  for (const sz of [1, -1]) {
    for (const sx of [-1, 1]) {
      const l = goatLeg(sz > 0)
      l.position.set(sx * 0.13, -0.14, sz * 0.26)
      body.add(l)
      legs.push(l)
    }
  }

  // --- tail: a perky up-flick tuft, pivot at the rump.
  const tail = new THREE.Group()
  tail.position.set(0, 0.15, -0.39)
  tail.rotation.x = -0.4
  const tuft = ball(0.055, COAT, 1)
  tuft.scale.set(0.75, 1.3, 0.7)
  tuft.position.set(0, 0.055, -0.015)
  tail.add(tuft)
  const tailTip = ball(0.032, COAT_DEEP, 1)
  tailTip.position.set(0, 0.115, -0.03)
  tail.add(tailTip)
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
      ears[i].rotation.z = -sx * (0.5 - 0.42 * curEngage)
      ears[i].rotation.y = sx * -0.5 * curEngage
    }
  }

  return { root, head, body, legs, ears, tail, lookAt }
}
