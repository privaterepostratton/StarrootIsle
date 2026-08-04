import * as THREE from 'three'
import {
  createHoeModel,
  createWateringCanModel,
  createAxeModel,
  createPickaxeModel,
  createShovelModel,
} from '../assets/character'
import { getFarmerModel } from '../assets/models'
import { Input } from '../core/input'
import type { Engine } from '../core/engine'
import { groundHeight, isWalkable } from './terrain'
import { SPAWN } from './village'
import type { Obstacle, Wall } from './world'

const WALK_SPEED = 5.2
const ACCEL = 34
const TURN_SPEED = 14
const PLAYER_RADIUS = 0.35
/** How tall the farmer stands. Every prop in the world is sized against this. */
export const PLAYER_HEIGHT = 1.6
/** Cross-fade between locomotion clips, in seconds. */
const CLIP_FADE = 0.18
/** Close enough to a click target to count as arrived. */
const ARRIVE_RADIUS = 0.28
/** Distance over which the farmer decelerates into a click target. */
const SLOWDOWN_RADIUS = 1.4

/** Which tool is visible in the hand. Driven by the pending tile action. */
export type HeldTool = 'none' | 'hoe' | 'can' | 'axe' | 'pick' | 'shovel'

/**
 * Which way a carried tool's shaft should point, in the *farmer's own* space.
 *
 * A two-hander is carried **level across the waist**, handle end past the near
 * hip and head out past the off one — not angled down at the ground. Every
 * sloped version of this ran into the same wall: the tool is nearly half the
 * figure's height, so any carry with the shaft near vertical puts the handle end
 * across the face, and tilting it far enough forward to clear the face drops the
 * off hand out of reach. Level solves both at once, and it is also the easiest
 * pose on this rig — the hands separate sideways, shoulder to shoulder, instead
 * of one having to reach down past the other.
 *
 * Character-relative rather than world-relative. Held in world space the shaft
 * tipped toward world +Z whichever way the farmer was facing, so walking south
 * carried the tool angled backwards.
 */
const SHAFT_TWO_HANDED = new THREE.Vector3(1, -0.08, 0.06).normalize()
const SHAFT_ONE_HANDED = new THREE.Vector3(0, -1, 0.35).normalize()
/**
 * And where the can points at the top of a pour: tipped forward over its own
 * spout, base swung back, so the water is plainly coming *out* of it.
 *
 * Blended into the aim rather than applied as a rotation on the model inside the
 * fist, for the same reason the two-hander's swing is: a tool that spins inside a
 * stationary hand reads as waggling it. The hand has to go somewhere too — see
 * HAND_POUR.
 */
const SHAFT_POURING = new THREE.Vector3(0, -0.75, -0.66).normalize()

/**
 * Which way the can's spout faces — carried, and pouring.
 *
 * Needed because aiming the shaft only pins one axis. The roll about it was left
 * to whatever `setFromUnitVectors` produced, which is the shortest arc from the
 * *hand bone's* current orientation — so the spout pointed somewhere different
 * depending on where the wrist happened to be in the walk cycle, and at rest it
 * lay across the farmer's own legs. A watering can is the one tool with an
 * obvious front, so it gets a full basis instead of an aim.
 *
 * +X is the farmer's left and +Z is forward, so carried the spout leads forward
 * and out past the right hip, clear of the thigh; pouring it swings down to face
 * the soil in front.
 */
const SPOUT_CARRY = new THREE.Vector3(-0.55, -0.1, 1).normalize()
const SPOUT_POUR = new THREE.Vector3(0, -0.66, 0.75).normalize()
/**
 * Where the shaft points at the top of a wind-up: up and behind the near shoulder.
 *
 * The swing has to move *this*, not just the arm. The shaft is pinned to a fixed
 * character-space direction every frame, so a raised arm on its own only lifts
 * the fist and slides the tool upward still pointing the same way — the head
 * stays down by the shins through the whole "swing". Blending the aim itself is
 * what turns it into an arc.
 */
const SHAFT_WOUND_UP = new THREE.Vector3(0.9, 0.6, -0.3).normalize()
/** And where it drives on the follow-through: steeper and further forward than carry. */
const SHAFT_STRUCK = new THREE.Vector3(0.02, -1, 0.42).normalize()
/** The tool models' own shaft direction — head down -Y, handle running up +Y. */
const SHAFT_AXIS = new THREE.Vector3(0, -1, 0)

/** Tools gripped with both hands. The watering can is the only one-hander. */
const TWO_HANDED: Record<HeldTool, boolean> = {
  none: false,
  hoe: true,
  axe: true,
  pick: true,
  shovel: true,
  can: false,
}

/**
 * Where the main fist goes while a two-hander is carried, wound up, and driven
 * down — in the farmer's own space, metres from the point between the feet.
 *
 * These are hard numbers off the rig rather than taste, because this character
 * has almost no arm to work with: the shoulders sit at y 0.74, a hand's width
 * either side of the spine, and upper arm plus forearm together measure 0.29.
 * Every pose has to keep *both* fists inside a 0.29 ball around their own
 * shoulder or an arm silently maxes out and the hand stops tracking the tool.
 * That is why a two-hander is carried in front of the sternum here rather than
 * out at the hip the way a full-size figure would: at the hip it is 0.37 from
 * the off shoulder, and no amount of posing gets the second hand onto it.
 */
const HAND_CARRY = new THREE.Vector3(-0.1, 0.56, 0.15)
/*
 * The wind-up goes up and *out over the off shoulder*, not back over the head,
 * and the shaft with it. Two reasons, in order of how badly they broke it:
 *
 * The off hand grips below the main fist, which means it sits between the fist
 * and the head of the tool — so it follows the head wherever the head goes.
 * Wound up over the near shoulder the head swings out to that side and takes the
 * off hand with it, 0.4 from a shoulder that can reach 0.29. Over the off
 * shoulder the same motion carries that hand *toward* its own shoulder.
 *
 * And this head is a third of the figure and wears a hat wider than it: a tool
 * raised behind the head buries its blade in the brim, and from the front — where
 * the camera usually sits — the whole wind-up disappears behind the hat.
 */
const HAND_WOUND_UP = new THREE.Vector3(0.02, 0.8, 0.02)
const HAND_STRUCK = new THREE.Vector3(0.02, 0.82, 0.08)

/**
 * The same two anchors for the one-hander: the can carried down at the near hip,
 * and lifted out in front to pour.
 *
 * The can had no anchors at all until now, because the grip solve was gated on
 * the *two-handed* weight — so for the one tool that does not use it, nothing
 * ever placed the fist. The can hung off the wrist bone wherever the walk clip
 * happened to leave it, which put it floating in front of the chest, and a pour
 * could only spin it on the spot because there was no position to animate.
 *
 * Both are inside the 0.29 the arm can reach from a shoulder at (-0.13, 0.74, 0)
 * — the pour anchor is the binding one, and reaching any further forward than
 * this locks the elbow straight.
 */
const HAND_CARRY_ONE = new THREE.Vector3(-0.19, 0.46, 0.04)
const HAND_POUR = new THREE.Vector3(-0.08, 0.6, 0.22)

/**
 * How far *down* the shaft from the main fist the off hand closes, in tool units.
 *
 * The main fist takes the top of the handle and the off hand grips well down the
 * shaft, the way a shovel or a hoe is actually held.
 *
 * How far down is a reach problem, not a taste one: the off hand has to stay
 * inside a 0.29 ball around a shoulder already 0.13 across the body from the
 * shaft, so every centimetre spent going down the handle is one it cannot spend
 * reaching across. Two things buy the room for a proper spread — carrying the
 * tool on the midline rather than out at the near hip, and standing the shaft
 * steeper, since forward is the direction the off shoulder can least afford.
 */
const OFF_HAND_GAP: Record<HeldTool, number> = {
  none: 0,
  hoe: 0.3,
  axe: 0.26,
  pick: 0.26,
  shovel: 0.3,
  can: 0,
}

/**
 * Which way each elbow breaks, in the farmer's own space: out to its own side,
 * down and back. +X is the farmer's left.
 *
 * A two-bone solve has a whole circle of valid elbow positions, and without a
 * pole like this it picks one arbitrarily — which for an arm reaching across the
 * body means an elbow that snaps through the ribs the moment the target moves.
 */
const ELBOW_POLE_L = new THREE.Vector3(0.6, -1, -0.45).normalize()
const ELBOW_POLE_R = new THREE.Vector3(-0.6, -1, -0.45).normalize()

/** Scratch for the per-frame grip and off-hand solves, so they allocate nothing. */
const gripBoneWorld = new THREE.Quaternion()
const gripShaft = new THREE.Vector3()
const shaftWorld = new THREE.Vector3()
const spoutWorld = new THREE.Vector3()
const basisX = new THREE.Vector3()
const basisY = new THREE.Vector3()
const basisZ = new THREE.Vector3()
const basisM = new THREE.Matrix4()
const qGrip = new THREE.Quaternion()
const ikTarget = new THREE.Vector3()
const ikShoulder = new THREE.Vector3()
const ikElbow = new THREE.Vector3()
const ikWrist = new THREE.Vector3()
const ikDir = new THREE.Vector3()
const ikPole = new THREE.Vector3()
const ikPerp = new THREE.Vector3()
const ikBend = new THREE.Vector3()
const ikFrom = new THREE.Vector3()
const handAnchor = new THREE.Vector3()
const ikA = new THREE.Vector3()
const ikB = new THREE.Vector3()
const qScratch = new THREE.Quaternion()
const qAimA = new THREE.Quaternion()
const qAimB = new THREE.Quaternion()
const qArm = new THREE.Quaternion()
const qFore = new THREE.Quaternion()
const qSolved = new THREE.Quaternion()

/**
 * Where each tool sits in the fist.
 *
 * `slide` runs along the tool's own shaft: the models put their head at the
 * origin with the handle running up +Y, so a positive slide pushes the tool up
 * through the hand. The long-shafted tools sit near zero — the fist closes at
 * the very end of the handle, leaving the whole shaft below it for the off hand
 * and hanging the head down by the farmer's feet, which is where a carried
 * shovel actually is. The watering can hangs from a top handle and barely moves.
 */
const GRIP_OFFSET: Record<HeldTool, { x: number; y: number; z: number; slide: number }> = {
  none: { x: 0, y: 0, z: 0, slide: 0 },
  hoe: { x: 0.02, y: 0, z: 0.03, slide: -0.04 },
  axe: { x: 0.02, y: 0, z: 0.03, slide: -0.05 },
  pick: { x: 0.02, y: 0, z: 0.03, slide: -0.05 },
  shovel: { x: 0.02, y: 0, z: 0.03, slide: -0.02 },
  // Negative: the can hangs *below* the fist, from its own top handle, which is
  // where the handle is on the model and how anyone carries one. At +0.05 it was
  // balanced above the hand at hip height like a lantern.
  can: { x: 0.03, y: 0, z: 0.02, slide: -0.07 },
}

/**
 * Swing a bone so its child lands somewhere else, keeping whatever roll the clip gave it.
 *
 * Works off the bone's *current* child direction rather than a bind-pose axis, so
 * it composes with the animation underneath instead of replacing it — which is
 * what lets the off arm be solved on top of a walk cycle.
 */
function aimBone(bone: THREE.Object3D, childWorld: THREE.Vector3, wantWorld: THREE.Vector3) {
  bone.getWorldPosition(ikFrom)
  ikA.copy(childWorld).sub(ikFrom)
  ikB.copy(wantWorld).sub(ikFrom)
  if (ikA.lengthSq() < 1e-10 || ikB.lengthSq() < 1e-10) return
  qAimA.setFromUnitVectors(ikA.normalize(), ikB.normalize())
  bone.getWorldQuaternion(qAimB)
  qAimB.premultiply(qAimA)
  if (bone.parent) bone.parent.getWorldQuaternion(qAimA).invert().multiply(qAimB)
  else qAimA.copy(qAimB)
  bone.quaternion.copy(qAimA)
}

export class Player {
  readonly object: THREE.Object3D

  /**
   * The authored farmer, driven by its own clips.
   *
   * The clips are locomotion only, so a tool swing is animated on the held tool
   * rather than on a bone: the mixer overwrites every bone it has a track for on
   * every frame, so a hand-posed arm would be erased as soon as it was set.
   */
  private readonly mixer: THREE.AnimationMixer
  private readonly idle: THREE.AnimationAction | null
  private readonly walk: THREE.AnimationAction | null
  private readonly run: THREE.AnimationAction | null
  private current: THREE.AnimationAction | null = null
  /** Where held tools hang. Falls back to the root if the rig names no hand. */
  private readonly hand: THREE.Object3D
  /** Static hold transform per tool; the tool itself stays at identity inside. */
  private readonly grips: Partial<Record<HeldTool, THREE.Group>> = {}
  /**
   * Bones the action overlay poses on top of the mixer.
   *
   * The clips are locomotion only, so a tool swing has to be authored in code —
   * and it has to be applied *after* mixer.update each frame, because the mixer
   * rewrites every bone it has a track for. Additive rotation deltas layered on
   * whatever the clip posed, so the swing survives being mid-stride.
   */
  private readonly armR: THREE.Object3D | null
  private readonly foreArmR: THREE.Object3D | null
  private readonly spine: THREE.Object3D | null
  /**
   * The off arm, solved onto the shaft with two-bone IK rather than posed by hand.
   *
   * A tool held in one fist with the other arm swinging free is the single thing
   * that reads as wrong at a glance — nobody digs one-handed. Hand-authored angles
   * cannot fix it, because the hand that has to be reached moves with the clip
   * underneath; the off hand has to be *solved* against wherever the shaft ended
   * up this frame.
   */
  private readonly armL: THREE.Object3D | null
  private readonly foreArmL: THREE.Object3D | null
  private readonly handL: THREE.Object3D | null
  /**
   * How much the grip solve owns the *main* arm. Rises for any tool at all.
   *
   * Split from grip2 so the watering can gets a placed fist like everything else
   * — it is the one tool the off hand does not join, and sharing one weight meant
   * "no second hand" was silently also "no first hand".
   */
  private grip1 = 0
  /** Eases the two-handed grip in and out so swapping tools doesn't snap the arm. */
  private grip2 = 0
  /** This frame's swing shape, read by the tool aim: wind-up amount and drive amount. */
  private swingUp = 0
  private swingDown = 0
  /** This frame's pour shape, the one-handed equivalent. */
  private pour = 0

  /** Starts on the lane at the market square, facing up the street. */
  readonly position = SPAWN.clone()

  private readonly velocity = new THREE.Vector3()
  private facing = 0

  /** Which way the farmer is looking, as a heading in radians. Read by anything
   *  that has to know what is *in front of* them rather than merely near. */
  get heading() {
    return this.facing
  }

  /** Counts down while an action animation plays; movement still allowed. */
  private actionTimer = 0
  private actionKind: HeldTool = 'none'

  private readonly tools: Record<Exclude<HeldTool, 'none'>, THREE.Group>
  private tool: HeldTool = 'none'

  private readonly tmpF = new THREE.Vector3()
  private readonly tmpR = new THREE.Vector3()

  /** Click-to-move destination, or null when steering by keyboard. */
  private moveTarget: THREE.Vector3 | null = null
  /** Set on the frame the farmer reaches a click target. */
  arrivedThisFrame = false
  /** Guards against a farmer who is wedged on scenery walking forever. */
  private stuckTimer = 0

  constructor() {
    const farmer = getFarmerModel()
    this.object = farmer.root
    this.object.position.copy(this.position)

    this.mixer = new THREE.AnimationMixer(farmer.root)
    const action = (clip?: THREE.AnimationClip) => (clip ? this.mixer.clipAction(clip) : null)
    this.idle = action(farmer.idle)
    this.walk = action(farmer.walk)
    this.run = action(farmer.run)
    this.current = this.idle
    this.current?.play()

    let hand: THREE.Object3D | null = null
    let armR: THREE.Object3D | null = null
    let foreArmR: THREE.Object3D | null = null
    let armL: THREE.Object3D | null = null
    let foreArmL: THREE.Object3D | null = null
    let handL: THREE.Object3D | null = null
    let spine: THREE.Object3D | null = null
    this.object.traverse((o) => {
      if (!hand && /right.?hand$/i.test(o.name)) hand = o
      if (!armR && /right.?arm$/i.test(o.name)) armR = o
      if (!foreArmR && /right.?fore.?arm$/i.test(o.name)) foreArmR = o
      if (!handL && /left.?hand$/i.test(o.name)) handL = o
      if (!armL && /left.?arm$/i.test(o.name)) armL = o
      if (!foreArmL && /left.?fore.?arm$/i.test(o.name)) foreArmL = o
      // Prefer the highest spine bone found — it moves the chest, not the hips.
      // `\d*`, not `\d?`: this rig names them Spine / Spine01 / Spine02, and a
      // single optional digit only ever matched the lowest one, so the swing
      // used to fold the farmer at the waist instead of the chest.
      if (/spine\d*$/i.test(o.name)) spine = o
    })
    this.hand = hand ?? this.object
    this.armR = armR
    this.foreArmR = foreArmR
    this.armL = armL
    this.foreArmL = foreArmL
    this.handL = handL
    this.spine = spine

    this.tools = {
      hoe: createHoeModel(),
      can: createWateringCanModel(),
      axe: createAxeModel(),
      pick: createPickaxeModel(),
      shovel: createShovelModel(),
    }
    /*
     * Each tool hangs off its own grip node rather than straight off the bone.
     *
     * Parenting the tool directly left it at the wrist joint wearing the bone's
     * own orientation, and neither is where a tool is held. Mixamo hand bones run
     * their local +Y *down the arm toward the fingers*, while these tool models put
     * the head at the origin with the shaft running -Y — so at identity the shaft
     * pointed back up the forearm with the head at the fingertips, which is exactly
     * the floating-beside-the-fist look.
     *
     * The grip carries the static fix (flip the shaft to run past the fingers, then
     * slide along it so the fist closes near the middle) and the tool inside stays
     * at identity. That separation matters: the swing overlay in update() writes
     * `held.rotation.x` from zero every frame, so a static offset stored on the tool
     * itself would be wiped the first time anything swung.
     *
     * The scale undo lives here too. The rig is authored at a hundred times game
     * scale and scaled back on its root, so a bone this deep carries a large
     * accumulated scale; dividing it out is what keeps a hoe hoe-sized.
     */
    this.object.updateMatrixWorld(true)
    const handScale = new THREE.Vector3()
    this.hand.getWorldScale(handScale)
    const undo = 1 / (handScale.x || 1)
    for (const [name, model] of Object.entries(this.tools) as [HeldTool, THREE.Group][]) {
      const grip = new THREE.Group()
      grip.scale.setScalar(undo)
      // Orientation is solved per frame in update() — see aimHeldTool.
      const offset = GRIP_OFFSET[name] ?? GRIP_OFFSET.hoe
      grip.position.set(offset.x, offset.y, offset.z)
      grip.add(model)
      model.visible = false
      model.position.set(0, offset.slide, 0)
      this.hand.add(grip)
      this.grips[name] = grip
    }
  }

  /**
   * Point the held tool's shaft the same way in world space, whatever the arm is doing.
   *
   * Solved every frame rather than once at construction. The first attempt did it in
   * the constructor and came out horizontal, because at that point the mixer has never
   * run — so the hand bone is still in its *bind* pose with the arm out sideways, and
   * the compensation was computed against a pose the player never sees.
   *
   * Re-solving also means the tool no longer inherits wrist roll, which is what made
   * hand-picked Euler angles hopeless: they were only ever correct for one frame of one
   * animation. The shaft now hangs correctly through a walk, a run and a swing alike,
   * while still being carried by the hand's position.
   */
  private aimHeldTool() {
    if (this.tool === 'none') return
    const grip = this.grips[this.tool]
    if (!grip || !grip.parent) return
    if (!TWO_HANDED[this.tool]) {
      /*
       * The one-hander gets a full basis, not an aim.
       *
       * A shaft aim pins one axis and leaves the roll to the shortest arc from
       * the hand bone, which changes through the walk cycle — fine for a hoe,
       * which is symmetric about its shaft, and wrong for a can, whose spout is
       * the whole point. Both axes are named here so the spout faces the same way
       * every frame.
       */
      shaftWorld.copy(SHAFT_ONE_HANDED)
      spoutWorld.copy(SPOUT_CARRY)
      if (this.pour > 0) {
        shaftWorld.lerp(SHAFT_POURING, this.pour)
        spoutWorld.lerp(SPOUT_POUR, this.pour)
      }
      const facing = this.object.getWorldQuaternion(qScratch)
      shaftWorld.normalize().applyQuaternion(facing)
      spoutWorld.normalize().applyQuaternion(facing)

      // The model's shaft runs -Y, so +Y is the far end; the spout is its +X.
      basisY.copy(shaftWorld).negate()
      basisX.copy(spoutWorld).addScaledVector(basisY, -spoutWorld.dot(basisY))
      // Only if the two were asked to point the same way, which would be an
      // authoring mistake in the constants above rather than a runtime state.
      if (basisX.lengthSq() < 1e-8) basisX.set(1, 0, 0).addScaledVector(basisY, -basisY.x)
      basisX.normalize()
      basisZ.crossVectors(basisX, basisY)
      basisM.makeBasis(basisX, basisY, basisZ)
      qGrip.setFromRotationMatrix(basisM)

      grip.parent.getWorldQuaternion(gripBoneWorld)
      grip.quaternion.copy(gripBoneWorld.invert()).multiply(qGrip)
      return
    }

    shaftWorld.copy(SHAFT_TWO_HANDED)
    if (this.swingUp > 0) shaftWorld.lerp(SHAFT_WOUND_UP, this.swingUp)
    if (this.swingDown > 0) shaftWorld.lerp(SHAFT_STRUCK, this.swingDown)
    shaftWorld.normalize()
    shaftWorld.applyQuaternion(this.object.getWorldQuaternion(qScratch))
    grip.parent.getWorldQuaternion(gripBoneWorld)
    gripShaft.copy(shaftWorld).applyQuaternion(gripBoneWorld.invert())
    grip.quaternion.setFromUnitVectors(SHAFT_AXIS, gripShaft.normalize())
  }

  /**
   * Put one hand somewhere, and let the arm work out how.
   *
   * Analytic two-bone IK: place the elbow on the circle of solutions using the
   * pole to choose which way it breaks, aim the upper arm at it, then aim the
   * forearm at the target. `weight` cross-fades the whole solve against the clip
   * pose underneath, so a tool appearing eases the arm over instead of snapping it.
   *
   * Solved rather than posed because both ends move: the hand has to arrive at a
   * point that is itself derived from the other hand and from the swing, and a
   * hand-authored set of shoulder and elbow angles can only ever be right for one
   * frame of one animation.
   */
  private solveArm(
    arm: THREE.Object3D | null,
    foreArm: THREE.Object3D | null,
    hand: THREE.Object3D | null,
    target: THREE.Vector3,
    pole: THREE.Vector3,
    weight: number,
  ) {
    if (weight <= 0.002 || !arm || !foreArm || !hand) return

    arm.getWorldPosition(ikShoulder)
    foreArm.getWorldPosition(ikElbow)
    hand.getWorldPosition(ikWrist)
    const upper = ikShoulder.distanceTo(ikElbow)
    const lower = ikElbow.distanceTo(ikWrist)
    if (upper < 1e-4 || lower < 1e-4) return

    ikDir.copy(target).sub(ikShoulder)
    const raw = ikDir.length()
    if (raw < 1e-4) return
    ikDir.divideScalar(raw)
    // Clamped short of full extension: a perfectly straight arm is both a
    // singularity for the elbow solve and a locked-out pose nobody stands in.
    const reach = THREE.MathUtils.clamp(raw, Math.abs(upper - lower) + 1e-3, (upper + lower) * 0.985)

    ikPole.copy(pole).applyQuaternion(this.object.getWorldQuaternion(qScratch))
    ikPerp.copy(ikPole).addScaledVector(ikDir, -ikPole.dot(ikDir))
    // Pole parallel to the arm: any perpendicular will do, and this only ever
    // happens for a frame while the target swings through the pole direction.
    if (ikPerp.lengthSq() < 1e-8) ikPerp.set(-ikDir.y, ikDir.x, 0)
    if (ikPerp.lengthSq() < 1e-8) ikPerp.set(0, -ikDir.z, ikDir.y)
    ikPerp.normalize()

    const cos = THREE.MathUtils.clamp(
      (upper * upper + reach * reach - lower * lower) / (2 * upper * reach),
      -1,
      1,
    )
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
    ikBend
      .copy(ikShoulder)
      .addScaledVector(ikDir, upper * cos)
      .addScaledVector(ikPerp, upper * sin)

    qArm.copy(arm.quaternion)
    qFore.copy(foreArm.quaternion)

    aimBone(arm, ikElbow, ikBend)
    // The forearm hangs off the bone just moved, so its world transform has to be
    // rebuilt before it can be aimed — otherwise it is solved from last frame's elbow.
    arm.updateMatrixWorld(true)
    foreArm.getWorldPosition(ikElbow)
    hand.getWorldPosition(ikWrist)
    aimBone(foreArm, ikWrist, target)

    if (weight < 1) {
      qSolved.copy(arm.quaternion)
      arm.quaternion.copy(qArm).slerp(qSolved, weight)
      qSolved.copy(foreArm.quaternion)
      foreArm.quaternion.copy(qFore).slerp(qSolved, weight)
    }
    arm.updateMatrixWorld(true)
  }

  /**
   * Hands onto the tool: the main fist to a pose anchor, and — for a two-hander —
   * the off hand to wherever that left the shaft.
   *
   * The order matters and is the whole trick. The main fist is placed first, the
   * tool is aimed from the fist it is parented to, and only then is the off hand
   * solved against the tool's finished world transform — so the second hand is
   * always on the shaft, through a walk, a run and a swing alike, without a
   * second authored motion to keep in sync with the first.
   *
   * The main fist runs for every tool, the off hand only for the ones that take
   * two. That distinction is why there are two weights.
   */
  private solveGrip() {
    if (this.grip1 <= 0.002 || this.tool === 'none') return
    const held = this.tools[this.tool]
    const grip = this.grips[this.tool]
    if (!held || !grip) return

    if (TWO_HANDED[this.tool]) {
      handAnchor.copy(HAND_CARRY)
      if (this.swingUp > 0) handAnchor.lerp(HAND_WOUND_UP, this.swingUp)
      if (this.swingDown > 0) handAnchor.lerp(HAND_STRUCK, this.swingDown)
    } else {
      handAnchor.copy(HAND_CARRY_ONE)
      if (this.pour > 0) handAnchor.lerp(HAND_POUR, this.pour)
    }
    handAnchor.applyQuaternion(this.object.getWorldQuaternion(qScratch)).add(this.object.position)

    this.solveArm(this.armR, this.foreArmR, this.hand, handAnchor, ELBOW_POLE_R, this.grip1)
    this.aimHeldTool()

    if (this.grip2 <= 0.002) return
    grip.updateMatrixWorld(true)
    // Measured in the tool's own space, not the hand's, so a tool that pitches
    // inside the fist drags the off hand round with it instead of sliding out.
    ikTarget.set(0, -GRIP_OFFSET[this.tool].slide - OFF_HAND_GAP[this.tool], 0)
    held.localToWorld(ikTarget)
    this.solveArm(this.armL, this.foreArmL, this.handL, ikTarget, ELBOW_POLE_L, this.grip2)
  }

  setTool(tool: HeldTool) {
    if (this.tool === tool) return
    this.tool = tool
    for (const [name, model] of Object.entries(this.tools)) model.visible = name === tool
  }

  /** Send the farmer walking to a world position. */
  moveTo(target: THREE.Vector3) {
    this.moveTarget = target.clone()
    this.stuckTimer = 0
  }

  cancelMove() {
    this.moveTarget = null
  }

  get destination() {
    return this.moveTarget
  }

  /** Play the swing/pour animation. Called when an action succeeds. */
  playAction(kind: HeldTool) {
    this.actionKind = kind
    this.actionTimer = kind === 'can' ? 0.55 : 0.45
  }

  get isActing() {
    return this.actionTimer > 0
  }

  update(dt: number, engine: Engine, obstacles: Obstacle[], walls: Wall[], locked: boolean) {
    this.arrivedThisFrame = false

    const axis = locked ? { x: 0, y: 0, len: 0 } : Input.moveAxis()
    // Any keyboard input takes over immediately and drops the click target —
    // fighting the mouse for control feels broken. A modal cancels it too, so
    // the farmer doesn't keep walking behind the shop panel.
    if (axis.len > 0 || locked) this.moveTarget = null

    const desired = new THREE.Vector3()

    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.position.x
      const dz = this.moveTarget.z - this.position.z
      const dist = Math.hypot(dx, dz)

      if (dist < ARRIVE_RADIUS) {
        this.moveTarget = null
        this.arrivedThisFrame = true
      } else {
        // Ease off over the last stride so the farmer settles onto the spot
        // instead of overshooting and jittering around it.
        const speed = WALK_SPEED * Math.min(1, dist / SLOWDOWN_RADIUS)
        desired.set((dx / dist) * speed, 0, (dz / dist) * speed)

        // If we are barely moving but nowhere near the target, something is in
        // the way. Give up rather than shuffling against it forever.
        this.stuckTimer = Math.hypot(this.velocity.x, this.velocity.z) < 0.4 ? this.stuckTimer + dt : 0
        if (this.stuckTimer > 0.7) {
          this.moveTarget = null
          this.stuckTimer = 0
        }
      }
    } else if (!locked) {
      // Camera-relative movement: W is always "up the screen" regardless of
      // how the iso camera has been rotated with Q/R.
      const fwd = engine.screenForward(this.tmpF).multiplyScalar(axis.y)
      const right = engine.screenRight(this.tmpR).multiplyScalar(axis.x)
      desired.copy(fwd.add(right))
      if (desired.lengthSq() > 1) desired.normalize()
      desired.multiplyScalar(WALK_SPEED)
    }

    // Accelerate toward the desired velocity so starts and stops have weight.
    this.velocity.x += (desired.x - this.velocity.x) * Math.min(1, ACCEL * dt)
    this.velocity.z += (desired.z - this.velocity.z) * Math.min(1, ACCEL * dt)

    // Move each axis independently so hitting a riverbank or cliff slides the
    // player along it rather than sticking them to it.
    const dx = this.velocity.x * dt
    const dz = this.velocity.z * dt
    if (isWalkable(this.position.x + dx, this.position.z)) this.position.x += dx
    else this.velocity.x = 0
    if (isWalkable(this.position.x, this.position.z + dz)) this.position.z += dz
    else this.velocity.z = 0

    this.resolveCollisions(obstacles)
    this.resolveWalls(walls)

    // Follow the terrain. Smoothed rather than snapped so stepping onto a
    // bridge deck or a hillside doesn't pop the camera.
    const targetY = groundHeight(this.position.x, this.position.z)
    this.position.y += (targetY - this.position.y) * Math.min(1, dt * 14)

    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    if (speed > 0.25) {
      const target = Math.atan2(this.velocity.x, this.velocity.z)
      this.facing = angleLerp(this.facing, target, Math.min(1, TURN_SPEED * dt))
    }

    this.object.position.copy(this.position)
    this.object.rotation.y = this.facing

    this.animate(dt, speed)
  }

  private resolveCollisions(obstacles: Obstacle[]) {
    // Push out of each overlapping circle. Order-dependent, but with obstacles
    // this sparse a single pass is stable enough and costs nothing.
    // Only obstacles within a couple of units can possibly overlap, so the
    // cheap AABB reject keeps this linear scan free even with hundreds of
    // trees in the world.
    for (const o of obstacles) {
      // Colliders belonging to a building that has not arrived yet.
      if (o.off) continue
      const dx = this.position.x - o.x
      if (dx > 3 || dx < -3) continue
      const dz = this.position.z - o.z
      if (dz > 3 || dz < -3) continue
      const minDist = o.r + PLAYER_RADIUS
      const dist = Math.hypot(dx, dz)
      if (dist < minDist && dist > 1e-5) {
        const push = (minDist - dist) / dist
        this.position.x += dx * push
        this.position.z += dz * push
      }
    }
  }

  /**
   * Push out of any fence run the player has ended up inside.
   *
   * Each wall is treated as a box grown by the player's radius, and the player
   * is ejected along whichever axis they are *least* deep into — which for a
   * thin run is almost always across it, so walking into a fence at an angle
   * slides along it instead of stopping dead. Ejecting along the deeper axis
   * would fling the player the length of the fence.
   *
   * Velocity is zeroed on the ejection axis only, or they would keep
   * accelerating into the wall and jitter against it.
   */
  private resolveWalls(walls: Wall[]) {
    for (const w of walls) {
      // Fences that are not standing yet — see Wall.off.
      if (w.off) continue
      const dx = this.position.x - w.x
      const ex = w.hx + PLAYER_RADIUS
      const overlapX = ex - Math.abs(dx)
      if (overlapX <= 0) continue

      const dz = this.position.z - w.z
      const ez = w.hz + PLAYER_RADIUS
      const overlapZ = ez - Math.abs(dz)
      if (overlapZ <= 0) continue

      if (overlapX < overlapZ) {
        this.position.x += dx >= 0 ? overlapX : -overlapX
        this.velocity.x = 0
      } else {
        this.position.z += dz >= 0 ? overlapZ : -overlapZ
        this.velocity.z = 0
      }
    }
  }

  /**
   * Drive the clips from how fast the farmer is actually moving.
   *
   * Cross-faded rather than switched, so nothing pops, and the playback rate
   * tracks speed: a cycle played at a fixed rate while the body moves at a
   * variable one makes the feet skate however good the clip is.
   */
  private animate(dt: number, speed: number) {
    const norm = Math.min(1, speed / WALK_SPEED)

    let next = this.idle
    let rate = 1
    if (speed > 0.3) {
      const running = norm > 0.66 && !!this.run
      next = running ? this.run : (this.walk ?? this.run)
      // Normalised against the fraction of top speed each clip was authored for,
      // and floored so a crawl does not play as slow motion.
      rate = running ? Math.max(0.75, norm / 0.85) : Math.max(0.65, norm / 0.55)
    }

    if (next !== this.current) {
      next?.reset().setEffectiveTimeScale(rate).fadeIn(CLIP_FADE).play()
      this.current?.fadeOut(CLIP_FADE)
      this.current = next
    } else {
      this.current?.setEffectiveTimeScale(rate)
    }

    // The mixer poses the skeleton first; the swing overlay below then adds
    // its deltas on top of whatever the clip decided this frame.
    this.mixer.update(dt)

    // Ease the grips in and out. Snapping either on the frame a tool appears
    // throws an arm across the body in one step.
    this.grip1 += ((this.tool === 'none' ? 0 : 1) - this.grip1) * Math.min(1, dt * 9)
    const wants = TWO_HANDED[this.tool] ? 1 : 0
    this.grip2 += (wants - this.grip2) * Math.min(1, dt * 9)

    const held = this.tool === 'none' ? null : this.tools[this.tool]
    this.swingUp = 0
    this.swingDown = 0
    this.pour = 0

    if (this.actionTimer > 0) {
      this.actionTimer -= dt
      const total = this.actionKind === 'can' ? 0.55 : 0.45
      const t = 1 - Math.max(0, this.actionTimer) / total

      if (this.actionKind === 'can') {
        /*
         * Pour: the can travels out in front and tips as it goes, then comes
         * back to the hip. One curve drives the hand anchor and the aim together,
         * the same way the chop drives the grip and the shaft, so it reads as
         * lifting the can rather than as rolling the wrist.
         *
         * The arm deltas that used to live here are gone: the fist is solved to
         * an anchor now, and the solve overwrites them anyway.
         */
        this.pour = Math.sin(Math.min(1, t * 1.4) * Math.PI) * this.grip1
        // Just enough forward lean to say the weight went with it.
        if (this.spine) this.spine.rotation.x += this.pour * 0.12
      } else {
        /*
         * Chop, as one motion through the whole body: wind up over the first
         * third — arm high, chest back — then drive down and follow through
         * with a forward lean. The same curve drives arm, forearm, spine and
         * tool, which is what makes it read as a swing instead of four parts
         * wiggling on their own schedules.
         */
        const raise = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65
        const lean = Math.sin(Math.min(1, t * 1.2) * Math.PI)
        /*
         * Two-handed, the arc lives in where the hands go and where the shaft
         * points — both read by solveGrip below. A tool rotated inside a fist
         * that stays put reads as waggling it; moving the grip swings the whole
         * tool, and the off hand, being solved onto the shaft, comes with it.
         *
         * The arm and tool deltas underneath are the old one-handed swing, faded
         * out by exactly as much as the two-handed grip is faded in — they would
         * be overwritten by the solve anyway, and the can still needs them.
         */
        this.swingUp = raise * this.grip2
        // Drive: peaks just after the tool passes the carry angle on the way down.
        this.swingDown = Math.max(0, Math.sin(Math.max(0, (t - 0.45) / 0.55) * Math.PI)) * this.grip2
        const solo = 1 - this.grip2
        if (held) held.rotation.x = raise * 1.9 * solo
        if (this.armR) this.armR.rotation.x -= raise * 1.7 * solo
        if (this.foreArmR) this.foreArmR.rotation.x -= raise * 0.65 * solo
        if (this.spine) this.spine.rotation.x += lean * 0.22
      }

      if (this.actionTimer <= 0) {
        this.actionKind = 'none'
        if (held) held.rotation.x = 0
      }
    } else if (held) {
      held.rotation.x = 0
    }

    // Grip last, on the finished pose. It reads the skeleton's world transforms,
    // so anything that poses a bone after it shows up as a frame of lag between
    // the hands and whatever is supposedly held in them.
    this.object.updateMatrixWorld(true)
    if (this.grip1 > 0.002) this.solveGrip()
    else this.aimHeldTool()
  }
}

function angleLerp(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
