import * as THREE from 'three'
import { cloneGoatModel, loadGoatModel, peekGoatModel, type GoatSourceModel } from '../models'

/**
 * The island goat — the hero asset of the whole opening.
 *
 * This used to be a procedural box rig in the school of animal.ts and
 * critters.ts: twelve fleece lumps, four tapering tubes and a spiral of discs
 * for the marking. It is now an authored, skinned GLB (public/models/goat.glb,
 * 4.3k triangles, 27 joints), and everything below exists to make that model
 * answer to the same six-field `GoatRig` the scripted arrival in
 * game/opening/goat.ts has always driven.
 *
 * The shape of the problem
 * -----------------------
 * goat.ts choreographs beat 9 by writing transforms directly — `legs[i]
 * .rotation.x` for the gait, `tail.rotation.z` for the wag, `body.position.y`
 * for the bob, and `lookAt(point)` for the beat's payoff. An authored rig
 * cannot receive those writes literally: its bones have their own rest
 * orientations (the head bone's local +Y points along the goat's nose, the
 * hind-leg bone's local X is 60° off the body's), so `rotation.x = 0.5` on a
 * bone means something different on every limb, and on most of them it means
 * "dislocate".
 *
 * So the rig hands back *control groups* — detached Object3Ds that carry no
 * geometry and live outside the scene graph. goat.ts writes them exactly as it
 * always did; `lookAt` — which the caller already invokes once per frame, last,
 * at the end of every pose — reads them back and converts each one into a
 * rotation about the goat's BODY axes, re-expressed in the bone's own parent
 * space. That conversion is the whole trick: it means the arrival's
 * choreography is written in one honest frame (x = across, y = up, z = the way
 * the goat is pointing) no matter how the animator happened to orient a joint.
 *
 * Two fields are real scene objects rather than controls, because the caller
 * needs more from them than a number:
 *
 *   - `body` is the group the model actually hangs in, holding the model down
 *     by GOAT_BODY_Y so that the caller's `body.position.y = GOAT_BODY_Y + bob`
 *     lands the hooves at y=0 with the bob on top. Its rotation and its breath
 *     scale then apply to the whole animal, legs included — which is what the
 *     box rig did too, since its legs were children of the body.
 *   - `head` is an empty marker parented to the head BONE, sitting on the face
 *     between skull and muzzle. The camera pushes in on `headPoint()` for the
 *     look beat, so this has to track the real head every frame, and being a
 *     child of the bone is the only way it does that for free.
 *
 * The baked take
 * --------------
 * The export ships one clip, "Armature|Unreal Take|baselayer": 30 frames over
 * one second, in place, with the legs cycling through a full stride and the
 * spine and tail carrying a little follow-through. It is a walk, and it is a
 * better walk than four rigid rotations at the hips will ever be — it has
 * knees. So it plays *under* the scripted pose, at a weight taken from how
 * fast the caller is actually moving the root, and the scripted leg swing
 * fades out by the same amount so the two never fight. Standing still (sniff,
 * eat, look, bleat) the weight is zero and the goat is posed entirely by the
 * script; bounding away at 3.4 u/s it is zero again, because a walk cycle
 * underneath a leap reads as a glitch. The look-at is never blended: it is
 * applied on top of whatever the clip did, always, at full strength.
 *
 * Grounding and scale
 * -------------------
 * The mesh is measured, not guessed. A skinned mesh's vertex buffer is in bind
 * space, and for this asset bind space happens to *be* the file's own scene
 * space (three binds glTF skins with an identity bind matrix and rebuilds the
 * inverse each frame), so the geometry's bounding box is a true measurement of
 * the animal at rest — 0.00683 units tall, which is then scaled to GOAT_HEIGHT
 * and lifted by its own `min.y` so the hooves sit on the ground rather than
 * near it.
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

/**
 * Body group rest height. Not a measurement any more — it is the contract the
 * caller writes against (`body.position.y = GOAT_BODY_Y + bob`), so the model
 * hangs GOAT_BODY_Y *below* the body group to cancel it out. It also sets where
 * the body's lean and its breath scale pivot: mid-back, which is where a lean
 * looks like a lean rather than like a topple.
 */
export const GOAT_BODY_Y = 0.52

/**
 * Overall standing height, ear tips included, in world units.
 *
 * A small island goat, measured against the 1.6-unit farmer and the 1.55-unit
 * wild cow: chest-high on a person, well under half the cow. Bigger than this
 * and the animal that is supposed to feel like a wild visitor starts reading as
 * livestock the player owns.
 */
const GOAT_HEIGHT = 0.95

/** How far the head will turn to track (radians). Past this the goat would
 *  need to move its body, which is the animator's job, not the rig's. */
const YAW_LIMIT = 1.15
const PITCH_UP_LIMIT = 0.6
/** Generous downward reach: sniffing and eating pose through lookAt too. */
const PITCH_DOWN_LIMIT = 0.95
/** Per-call blend toward the look target (rig is driven at frame rate). */
const TRACK_BLEND = 0.18

/**
 * Ear engagement, the second half of "it looks at you".
 *
 * Three rotations rather than one, all about body axes: forward swings the tip
 * toward the nose, turn brings the cup round to face the player, lift takes it
 * out of the resting droop. Together they are the difference between a goat
 * whose head happens to be pointing your way and a goat that is listening.
 */
const EAR_FORWARD = 0.5
const EAR_TURN = 0.3
const EAR_LIFT = 0.22

/** Leg roots in the caller's [FL, FR, RL, RR] order. The unprefixed bones sit
 *  on +x and the R_ ones on -x, whatever their names suggest. */
const LEG_BONES = ['R_frontleg', 'frontleg', 'R_backleg', 'backleg']
/** Ears, in the caller's [-x, +x] order — matching how the box rig indexed. */
const EAR_BONES = ['R_earend', 'earend']
/** The wag is spread down the chain so the tail whips instead of hinging. */
const TAIL_BONES = ['tail', 'tailstart', 'tail1', 'tail2', 'tail3']
const TAIL_SHARE = [0.5, 0.35, 0.35, 0.35, 0.35]

/** Root speed (u/s) at which the baked walk reaches full weight, and where it
 *  gives up because the caller has started bounding rather than walking. */
const CLIP_IN = 0.25
const CLIP_FULL = 0.85
const CLIP_OUT = 2.0
const CLIP_GONE = 3.0
/** The speed the take was authored at, near enough — sets its playback rate so
 *  the hooves do not skate. */
const CLIP_REF_SPEED = 1.1

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * One bone the script drives, with the goat's body axes pre-rotated into that
 * bone's parent space.
 *
 * Computed once, from the rest pose. The clip does move the parents a little,
 * so these axes drift by a degree or two mid-stride — far below the threshold
 * where anyone could see it, and worth it for not doing three quaternion
 * inversions per bone per frame.
 */
interface Joint {
  bone: THREE.Object3D
  rest: THREE.Quaternion
  /** Body +x (across, toward +x), +y (up) and +z (forward), in parent space. */
  x: THREE.Vector3
  y: THREE.Vector3
  z: THREE.Vector3
}

/** Rotation of `obj` relative to `ancestor`, by walking up local quaternions. */
function rotationWithin(obj: THREE.Object3D, ancestor: THREE.Object3D): THREE.Quaternion {
  const out = new THREE.Quaternion()
  const step = new THREE.Quaternion()
  for (let o: THREE.Object3D | null = obj; o && o !== ancestor; o = o.parent) {
    step.copy(o.quaternion).multiply(out)
    out.copy(step)
  }
  return out
}

function makeJoint(bone: THREE.Object3D, frame: THREE.Object3D): Joint {
  // The bone is rotated *within* its parent, so the axes it must be given are
  // the body axes seen from the parent — hence the inverse.
  const inv = rotationWithin(bone.parent ?? bone, frame).invert()
  return {
    bone,
    rest: bone.quaternion.clone(),
    x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
    y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
    z: new THREE.Vector3(0, 0, 1).applyQuaternion(inv),
  }
}

/** Everything the rig needs from the loaded model, resolved once on attach. */
interface Attached {
  head: Joint
  ears: Joint[]
  legs: Joint[]
  tail: Joint[]
  mixer: THREE.AnimationMixer | null
  action: THREE.AnimationAction | null
}

export function createGoatModel(): GoatRig {
  const root = new THREE.Group()

  // The model hangs in here, pushed down by GOAT_BODY_Y so the caller's
  // `body.position.y = GOAT_BODY_Y + bob` puts the hooves back on the ground.
  const body = new THREE.Group()
  body.position.y = GOAT_BODY_Y
  root.add(body)
  const mount = new THREE.Group()
  mount.position.y = -GOAT_BODY_Y
  body.add(mount)

  // Face marker. Parented to `mount` until the model arrives and it can be
  // hung off the real head bone; the camera asks for its world position from
  // the first frame of the sequence, so it must never not exist.
  const head = new THREE.Group()
  head.position.set(0, GOAT_HEIGHT * 0.66, GOAT_HEIGHT * 0.42)
  mount.add(head)

  // Pure control groups: never added to the scene, never drawn. The caller
  // writes rotations on them and `lookAt` converts them onto bones.
  const legs = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()]
  const ears = [new THREE.Group(), new THREE.Group()]
  const tail = new THREE.Group()

  let rig: Attached | null = null

  function attach(source: GoatSourceModel): void {
    const inst = cloneGoatModel(source)
    const model = inst.root

    const skins: THREE.SkinnedMesh[] = []
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (m.isSkinnedMesh) skins.push(m)
    })
    const skin = skins[0]
    if (!skin) {
      console.warn('goat.glb contained no skinned mesh')
      return
    }

    /*
     * Measure, then scale and lift.
     *
     * The bounding box of the bind-pose vertex buffer is a real measurement of
     * this animal because three binds glTF skins with an identity bind matrix:
     * at rest every bone matrix is the identity and the drawn vertex is the
     * stored one. `min.y` is the sole of the hoof, so lifting by it is what
     * plants the goat instead of floating or sinking it.
     */
    const geo = skin.geometry
    if (!geo.boundingBox) geo.computeBoundingBox()
    const box = geo.boundingBox!
    const span = box.max.y - box.min.y
    const scale = span > 1e-6 ? GOAT_HEIGHT / span : 1
    model.position.y = -box.min.y
    mount.scale.setScalar(scale)
    mount.add(model)

    const bone = (name: string): THREE.Object3D | null => model.getObjectByName(name) ?? null
    const headBone = bone('head')
    const headEnd = bone('headend')
    if (!headBone) {
      console.warn('goat.glb has no "head" bone; the look beat will not read')
      return
    }

    /*
     * Move the face marker onto the head bone.
     *
     * Between the skull joint and the muzzle joint, biased toward the muzzle:
     * the look beat's push-in wants eyes and nose in frame, and the head bone
     * itself sits back inside the skull where a camera aimed at it frames the
     * goat's forehead and the sky above it.
     */
    root.updateMatrixWorld(true)
    const face = headBone.getWorldPosition(new THREE.Vector3())
    if (headEnd) face.lerp(headEnd.getWorldPosition(new THREE.Vector3()), 0.55)
    head.position.copy(face)
    headBone.worldToLocal(head.position)
    headBone.add(head)

    /*
     * Index alignment matters more than it looks: the caller addresses legs by
     * position ([FL, FR, RL, RR]) and a silently dropped bone would slide every
     * limb after it one place along, which photographs as a goat walking with
     * the wrong feet. A missing bone is a loud failure, not a short array.
     */
    const joints = (names: string[]): Joint[] => {
      const found = names.map((n) => bone(n)).filter((b): b is THREE.Object3D => b !== null)
      if (found.length !== names.length) {
        console.warn(`goat.glb is missing bones: expected ${names.join(', ')}`)
      }
      return found.map((b) => makeJoint(b, mount))
    }

    let mixer: THREE.AnimationMixer | null = null
    let action: THREE.AnimationAction | null = null
    if (inst.clip) {
      mixer = new THREE.AnimationMixer(model)
      action = mixer.clipAction(inst.clip)
      action.play()
      // Weight zero *before* the first update, so the mixer records the rest
      // pose as the value it blends back toward when the goat stands still.
      action.setEffectiveWeight(0)
      mixer.update(0)
    }

    rig = {
      head: makeJoint(headBone, mount),
      ears: joints(EAR_BONES),
      legs: joints(LEG_BONES),
      tail: joints(TAIL_BONES),
      mixer,
      action,
    }
  }

  const ready = peekGoatModel()
  if (ready) attach(ready)
  else void loadGoatModel().then(attach).catch((e) => console.warn('goat.glb failed to load', e))

  // --- per-frame state -------------------------------------------------------
  let curYaw = 0
  let curPitch = 0
  let curEngage = 0
  let lastMs = 0
  let speed = 0
  const prevPos = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  const facePos = new THREE.Vector3()
  const spin = new THREE.Quaternion()

  /** Rotate a joint by `angle` about one of the goat's body axes. */
  function twist(j: Joint, axis: THREE.Vector3, angle: number): void {
    if (angle === 0) return
    spin.setFromAxisAngle(axis, angle)
    j.bone.quaternion.premultiply(spin)
  }

  function lookAt(worldPos: THREE.Vector3 | null): void {
    const now = performance.now()
    const dt = lastMs === 0 ? 0 : THREE.MathUtils.clamp((now - lastMs) / 1000, 0, 0.1)
    lastMs = now

    // --- how hard the goat is travelling, read off the root the caller moves.
    // A teleport (the first frame of the sequence, when the goat is placed at
    // the treeline) is not motion and must not spin the walk cycle up.
    const step = prevPos.distanceTo(root.position)
    prevPos.copy(root.position)
    const instant = dt > 1e-4 && step < 1 ? step / dt : 0
    speed += (instant - speed) * Math.min(1, dt * 6)

    // --- look target, resolved in the body's own frame.
    let tYaw = 0
    let tPitch = 0
    let tEngage = 0
    if (worldPos && rig) {
      head.updateWorldMatrix(true, false)
      head.getWorldPosition(facePos)
      body.worldToLocal(facePos)
      tmp.copy(worldPos)
      body.worldToLocal(tmp)
      tmp.sub(facePos)
      const flat = Math.hypot(tmp.x, tmp.z)
      tYaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -YAW_LIMIT, YAW_LIMIT)
      tPitch = THREE.MathUtils.clamp(Math.atan2(tmp.y, flat), -PITCH_DOWN_LIMIT, PITCH_UP_LIMIT)
      tEngage = 1
    }
    curYaw += (tYaw - curYaw) * TRACK_BLEND
    curPitch += (tPitch - curPitch) * TRACK_BLEND
    curEngage += (tEngage - curEngage) * TRACK_BLEND

    if (!rig) return

    /*
     * The baked walk, weighted by travel.
     *
     * In between CLIP_IN and CLIP_FULL it fades up; past CLIP_OUT it fades back
     * out, because above walking pace the caller is bounding and owns the legs
     * outright. The scripted swing is scaled by the complement, so at full clip
     * weight the hips are left almost entirely to the animator's stride and the
     * script contributes only a tenth — enough to keep the diagonal pairing of
     * the gait readable, not enough to fight it.
     */
    const clip = smoothstep(CLIP_IN, CLIP_FULL, speed) * (1 - smoothstep(CLIP_OUT, CLIP_GONE, speed))
    if (rig.mixer && rig.action) {
      rig.action.setEffectiveWeight(clip)
      rig.action.timeScale = THREE.MathUtils.clamp(speed / CLIP_REF_SPEED, 0.7, 1.5)
      rig.mixer.update(dt)
    } else {
      rig.head.bone.quaternion.copy(rig.head.rest)
      for (const j of [...rig.ears, ...rig.legs, ...rig.tail]) j.bone.quaternion.copy(j.rest)
    }

    /*
     * Head tracking. Pitch first, about the body's across-axis, then yaw about
     * the body's up-axis — nod, then turn, which is the order a neck does it in.
     *
     * The pitch is negated because a positive rotation about +x tips the nose
     * DOWN, while a positive `tPitch` means the target is above: the box rig
     * this replaced had that sign the other way round, so it looked at the sky
     * to eat and at the ground to be seen.
     */
    twist(rig.head, rig.head.x, -curPitch)
    twist(rig.head, rig.head.y, curYaw)

    for (let i = 0; i < rig.ears.length; i++) {
      const sx = i === 0 ? -1 : 1
      const ear = rig.ears[i]
      twist(ear, ear.x, EAR_FORWARD * curEngage)
      twist(ear, ear.y, -sx * EAR_TURN * curEngage)
      twist(ear, ear.z, sx * EAR_LIFT * curEngage)
    }

    const swing = 1 - 0.9 * clip
    for (let i = 0; i < rig.legs.length; i++) {
      twist(rig.legs[i], rig.legs[i].x, legs[i].rotation.x * swing)
    }

    for (let i = 0; i < rig.tail.length; i++) {
      twist(rig.tail[i], rig.tail[i].z, tail.rotation.z * (TAIL_SHARE[i] ?? 0.3))
    }
  }

  return { root, head, body, legs, ears, tail, lookAt }
}
