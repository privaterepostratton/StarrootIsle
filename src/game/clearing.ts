import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { groundHeight, isWalkable, isSand } from './terrain'
import { PLAYER_SLOT, FENCE_HX, FENCE_HZ, onLane, inAnyPlot } from './village'
import type { Obstacle } from './world'

/**
 * The trees standing where the farm will be, and cutting them down.
 *
 * This is the opening move of the game. The player wakes on the beach owning
 * nothing — no plot, no beds, not even the ground — walks inland, and buys the
 * removal of a handful of trees. The last one to come down opens the clearing,
 * and *that* is what creates the farm (see Farm.openClearing).
 *
 * Doing it this way rather than handing over a plot at spawn is the whole point
 * of the redesign: the first thing you own is the first thing you made a
 * decision about. It also gives the starting coins a job, which they never had
 * when the farm arrived free and the shop was the only thing to spend on.
 *
 * The trees stand *inside* the future fence line, which is why nothing else
 * plants there — `inAnyPlot` already covers the player's clearing, so the
 * forest scatter leaves that ground alone and these are the only trees on it.
 */

/** What each tree costs to clear. Sized against the coins a new game starts with. */
export const CLEAR_COST = 15

/** How close the player must be for the prompt to appear. */
const REACH = 2.8

/**
 * Where the trees stand, as offsets from the farm centre in tiles-ish units.
 *
 * Hand-placed rather than scattered: four trees in a loose arc across the front
 * of the plot, so they read as a stand blocking the ground rather than as a
 * random sprinkle, and so the player can see all of them from the approach
 * without walking a circuit to find the last one.
 */
const POSITIONS: { x: number; z: number; scale: number }[] = [
  { x: -3.4, z: -2.2, scale: 1.05 },
  { x: 1.2, z: -3.6, scale: 0.9 },
  { x: 3.9, z: 0.4, scale: 1.12 },
  { x: -1.0, z: 2.6, scale: 0.96 },
]

export interface Standing {
  object: THREE.Group
  x: number
  z: number
  obstacle: Obstacle
  cut: boolean
}

/**
 * A tree between the axe landing and the ground taking it.
 *
 * Felling used to be instant — the trunk simply stopped existing on the frame
 * the coins were spent, which is the one moment the opening most needs to feel
 * like work. It now tips over about its own base, lands, and is cleared away a
 * beat later, so the player sees what their fifteen coins bought.
 */
interface Falling {
  object: THREE.Group
  /** Seconds since the cut. */
  t: number
  /** Horizontal axis it topples about — perpendicular to the fall direction. */
  axis: THREE.Vector3
  /** The standing orientation, so the topple composes with its random yaw. */
  base: THREE.Quaternion
  /** The model's fitted scale — the shrink-out is relative to this, not to 1. */
  scale0: THREE.Vector3
  landed: boolean
}

/** Scratch for the topple. One rotation is solved per falling tree per frame. */
const TIP = new THREE.Quaternion()

/** Seconds from the cut to the crown hitting the ground. */
const FALL_TIME = 1.05
/**
 * How long the trunk lies there before it is cleared away.
 *
 * Long enough to register as a felled tree, short enough that the last one is
 * not standing between the player and the farm it just earned — the clearing
 * only opens once this has run out on every trunk.
 */
const REST_TIME = 0.9
/** Seconds it takes to shrink out once its rest is up. */
const CLEAR_TIME = 0.35

/**
 * The wood the clearing is cut out of.
 *
 * Trees packed in a band hugging the fence line, dense enough that the plot
 * reads as a hole someone made rather than as a fenced square in a meadow. The
 * global forest scatter cannot do this: it is uniform across the whole valley,
 * and at the density that makes a treeline look right at the map edge the
 * ground beside the farm is nearly bare.
 *
 * Outside the fence, never on it — these are scenery, not the four the player
 * fells, and a tree inside the rails would still be standing in the middle of
 * the farm afterwards.
 */
const SURROUND_COUNT = 90
const SURROUND_INNER = 1.2
const SURROUND_BAND = 11

export class Clearing {
  readonly group = new THREE.Group()
  private readonly trees: Standing[] = []
  private readonly falling: Falling[] = []

  /**
   * Fires when the last tree has *landed*, not when it was cut.
   *
   * This is what brings the farm into existence, and a farm that appears while
   * the tree that was standing on it is still in the air is the sort of thing
   * the whole falling animation exists to avoid.
   */
  onOpened: (() => void) | null = null
  /** Fires for each tree the moment the axe lands — chips and the thunk. */
  onCut: ((at: THREE.Vector3) => void) | null = null
  /** Fires when a trunk hits the ground: the dust, the leaves, the thump. */
  onLanded: ((at: THREE.Vector3) => void) | null = null

  constructor(obstacles: Obstacle[], rand: () => number = Math.random) {
    // The wood first, so the four fellable trees draw over it if they overlap.
    for (let i = 0; i < SURROUND_COUNT; i++) {
      const a = rand() * Math.PI * 2
      const reach = SURROUND_INNER + Math.sqrt(rand()) * SURROUND_BAND
      // An ellipse around the plot rather than a circle: the plot is a rectangle
      // and a circular band leaves the long sides bare and the corners stacked.
      const x = PLAYER_SLOT.x + Math.cos(a) * (FENCE_HX + reach)
      const z = PLAYER_SLOT.z + Math.sin(a) * (FENCE_HZ + reach)
      if (Math.abs(x - PLAYER_SLOT.x) < FENCE_HX + 0.8 && Math.abs(z - PLAYER_SLOT.z) < FENCE_HZ + 0.8) continue
      if (!isWalkable(x, z) || isSand(x, z)) continue
      /*
       * Not on the street, and not in a neighbour's garden.
       *
       * The band only had to dodge the player's own fence while the farm stood
       * alone on the coast with nothing near it. It is at the head of the lane
       * now, and the same band reached across the road and into the first two
       * plots — a wood growing through the village, which is the sort of thing
       * that looks like a missing exclusion because it is one.
       */
      if (onLane(x, z, 1.5) || inAnyPlot(x, z, 1)) continue

      const conifer = rand() < 0.35
      const model = conifer ? getModels().pine : getModels().tree
      const height = (conifer ? PROP_HEIGHT.pine : PROP_HEIGHT.tree) * (0.82 + rand() * 0.42)
      const tree = modelGroup(model, height)
      tree.position.set(x, groundHeight(x, z), z)
      tree.rotation.y = rand() * Math.PI * 2
      this.group.add(tree)
      obstacles.push({ x, z, r: 0.55 })
    }

    for (const p of POSITIONS) {
      const x = PLAYER_SLOT.x + p.x
      const z = PLAYER_SLOT.z + p.z
      const object = modelGroup(getModels().tree, PROP_HEIGHT.tree * p.scale)
      object.position.set(x, groundHeight(x, z), z)
      object.rotation.y = p.x * 1.7 + p.z
      this.group.add(object)

      const obstacle: Obstacle = { x, z, r: 0.55 }
      obstacles.push(obstacle)
      this.trees.push({ object, x, z, obstacle, cut: false })
    }
  }

  /** True once every tree is down — i.e. the farm exists. */
  get opened() {
    return this.trees.every((t) => t.cut)
  }

  get remaining() {
    return this.trees.filter((t) => !t.cut).length
  }

  /** Where the trees still standing are, for the tutorial's rings and trail. */
  standing(): { x: number; z: number }[] {
    return this.trees.filter((t) => !t.cut).map((t) => ({ x: t.x, z: t.z }))
  }

  /** The tree the player is standing next to, or null. */
  targetNear(pos: THREE.Vector3): Standing | null {
    let best: Standing | null = null
    let bestDist = REACH
    for (const t of this.trees) {
      if (t.cut) continue
      const d = Math.hypot(t.x - pos.x, t.z - pos.z)
      if (d < bestDist) {
        bestDist = d
        best = t
      }
    }
    return best
  }

  /** Fell the nearest tree. The caller has already taken the coins. */
  cutNear(pos: THREE.Vector3): boolean {
    const tree = this.targetNear(pos)
    return tree ? this.cut(tree, pos) : false
  }

  /**
   * Send this tree over, away from `away` (the chopper).
   *
   * The collider is disabled rather than removed: the obstacle array is shared
   * with every tree, rock and building in the world and is scanned by index
   * every frame, so splicing out of it mid-session would be a needless reshuffle
   * of several thousand entries to save four. It goes off on the *cut*, not on
   * the landing, so the player is never body-blocked by a trunk in mid-air.
   */
  cut(tree: Standing, away: THREE.Vector3): boolean {
    if (tree.cut) return false

    tree.cut = true
    tree.obstacle.off = true

    /*
     * It falls away from whoever swung the axe.
     *
     * Toward them would drop a trunk through the player, and a fixed direction
     * has all four landing in parallel like a felled row. The axis is the
     * horizontal perpendicular of that direction, so a rotation about it tips
     * the trunk along it.
     */
    const dx = tree.x - away.x
    const dz = tree.z - away.z
    const len = Math.hypot(dx, dz) || 1
    this.falling.push({
      object: tree.object,
      t: 0,
      axis: new THREE.Vector3(dz / len, 0, -dx / len),
      base: tree.object.quaternion.clone(),
      scale0: tree.object.scale.clone(),
      landed: false,
    })

    this.onCut?.(new THREE.Vector3(tree.x, groundHeight(tree.x, tree.z), tree.z))
    return true
  }

  /**
   * Drive the trees that are on their way down.
   *
   * The topple is `p²` rather than linear: a trunk that starts falling at full
   * speed reads as being pushed over, and the slow first few degrees followed by
   * an accelerating drop is the whole character of a tree coming down.
   */
  update(dt: number) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i]
      f.t += dt

      if (!f.landed) {
        const p = Math.min(1, f.t / FALL_TIME)
        const angle = (Math.PI / 2) * p * p
        f.object.quaternion.copy(f.base).premultiply(TIP.setFromAxisAngle(f.axis, angle))
        if (p >= 1) {
          f.landed = true
          f.t = 0
          this.onLanded?.(f.object.position.clone())
        }
        continue
      }

      if (f.t < REST_TIME) continue
      const gone = (f.t - REST_TIME) / CLEAR_TIME
      if (gone >= 1) {
        this.group.remove(f.object)
        f.object.scale.copy(f.scale0)
        this.falling.splice(i, 1)
        /*
         * The farm arrives when the ground is genuinely bare.
         *
         * Not on the cut (the tree is still standing in it), and not on the
         * landing either — the trunks lie across the plot for a beat afterwards,
         * and beds growing up through a fallen log is the one frame that gives
         * away that these are two unrelated animations. Waiting for the last one
         * to be carted off makes it a sequence: chopped, fallen, cleared, grown.
         */
        if (this.opened && this.falling.length === 0) this.onOpened?.()
        continue
      }
      f.object.scale.copy(f.scale0).multiplyScalar(1 - gone)
    }
  }

  /**
   * Take every tree down at once, without payment or effects.
   *
   * For a restored save: the clearing is already cut, and the trees must not be
   * standing in the middle of a farm the player has been working for hours.
   */
  restoreOpened() {
    for (const tree of this.trees) {
      if (tree.cut) continue
      tree.cut = true
      tree.obstacle.off = true
      this.group.remove(tree.object)
    }
  }
}
