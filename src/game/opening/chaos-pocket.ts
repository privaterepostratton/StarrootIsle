import * as THREE from 'three'
import { groundHeight } from '../terrain'
import type { Obstacle } from '../world'
import type { HoldTarget } from './types'
import {
  createChaosProp,
  createBougainvilleaSpill,
  type ChaosKind,
  type ChaosPropRig,
} from '../../assets/opening/chaos-props'
import { ball, cyl, MINOR_LAYER, setLayer } from '../../assets/style'
import { createLoamPatch } from '../../assets/opening/loam'

/**
 * The chaos pocket — the opening's core beat (spec beat 5).
 *
 * A ~6×4 patch of choked ground on the farm pad, mouth open toward the sea,
 * holding eleven required chaos objects and four voluntary extras on the rim.
 * The player holds each one clear (the amphora shard is the single tap), the
 * shared obstacle array lets them body their way between the tangles while
 * the pocket is still wild, and dark volcanic loam surfaces under every spot
 * they clear — order made visible in the ground itself.
 *
 * Design commitments carried from the contract:
 *
 *  - Gate-free: no costs, no counters, no timers. The pocket only ever gives.
 *  - `voluntaryCleared` is the thesis metric — the four rim extras are
 *    unprompted and unneeded, and whether players clear them anyway is what
 *    the whole D0 test exists to measure. They are never part of `cleared`.
 *  - Obstacles are disabled with `off = true`, never spliced: the array is
 *    shared with every tree and building in the world (Clearing's pattern).
 *  - Terrain is baked, so the choked-vs-cleared ground story is told entirely
 *    in conforming props: leaf-litter scatter while wild, small loam discs
 *    tilted to the local terrain slope once cleared. No vertex is touched.
 *  - The treeline-gap bougainvillea (-40, z ±4) ships from here too — flanking
 *    the gap mouth, corridor left open, the only magenta on screen.
 *  - No gold anywhere in this module. Guidance/pulse belongs to OpeningUi.
 */

/** World-space centre of the required pocket (contract §4.1). */
const CENTRE_X = -34
const CENTRE_Z = 0

/** Press-forgiveness radius handed to every hold target. */
const HOLD_RADIUS = 1.6
/** How close a tap must land to collect the amphora shard. */
const TAP_REACH = 1.8

/** Hold-to-clear seconds per kind (contract §2.4). Amphora is tap-only. */
const HOLD_DURATION: Record<ChaosKind, number> = {
  vine: 1.1,
  frond: 0.5,
  driftwood: 0.9,
  'morning-glory': 1.0,
  basket: 0.8,
  stone: 1.3,
  amphora: 0,
}

/**
 * Collision radii per kind. Bulky things block; flat things (the glory mat,
 * the shard) get token circles so the player is never fenced off a tap or a
 * peel by an invisible wall over something ankle-height.
 */
const OBSTACLE_R: Record<ChaosKind, number> = {
  vine: 0.55,
  frond: 0.35,
  driftwood: 0.5,
  'morning-glory': 0.3,
  basket: 0.45,
  stone: 0.5,
  amphora: 0.2,
}

export interface ChaosDrop {
  material: 'wood' | 'fiber' | 'stone' | null
  amount: number
  keepable: 'amphora-shard' | 'spiral-shell' | null
}

/** The spec's drop table: fibre from soft chaos, wood ×2 from the branch,
 *  stone from the pry, and the two surprises — shell in the basket, shard
 *  kept whole. */
function dropFor(kind: ChaosKind): ChaosDrop {
  switch (kind) {
    case 'vine':
    case 'frond':
    case 'morning-glory':
      return { material: 'fiber', amount: 1, keepable: null }
    case 'driftwood':
      return { material: 'wood', amount: 2, keepable: null }
    case 'basket':
      return { material: 'fiber', amount: 1, keepable: 'spiral-shell' }
    case 'stone':
      return { material: 'stone', amount: 1, keepable: null }
    case 'amphora':
      return { material: null, amount: 0, keepable: 'amphora-shard' }
  }
}

/**
 * Hand-authored layout, offsets from the pocket centre (x ∈ ±3, z ∈ ±2 is the
 * required footprint). Placed like Clearing places its trees: a composition,
 * not a scatter. The mouth faces the sea (-x), so the easy first acts — the
 * tap shard and the half-second frond — sit at the mouth where the arriving
 * player meets them, and the heavy pries stand deeper in.
 */
const REQUIRED: { kind: ChaosKind; dx: number; dz: number; variant: number }[] = [
  { kind: 'amphora', dx: -2.6, dz: -0.6, variant: 0 },
  { kind: 'frond', dx: -2.1, dz: 0.8, variant: 0 },
  { kind: 'morning-glory', dx: -1.5, dz: -1.5, variant: 0 },
  { kind: 'stone', dx: -1.1, dz: 1.3, variant: 0 },
  { kind: 'vine', dx: -0.4, dz: -0.6, variant: 0 },
  { kind: 'frond', dx: 0.3, dz: 0.4, variant: 1 },
  { kind: 'stone', dx: 1.0, dz: -1.6, variant: 1 },
  { kind: 'vine', dx: 1.2, dz: 1.5, variant: 1 },
  { kind: 'driftwood', dx: 2.2, dz: -0.9, variant: 0 },
  { kind: 'vine', dx: 2.4, dz: 0.6, variant: 2 },
  { kind: 'basket', dx: 2.6, dz: 1.7, variant: 0 },
]

/** The four voluntary extras, on the rim OUTSIDE the required footprint —
 *  visible from inside the pocket, prompted by nothing. */
const VOLUNTARY: { kind: ChaosKind; dx: number; dz: number; variant: number }[] = [
  { kind: 'vine', dx: -1.2, dz: 3.1, variant: 0 },
  { kind: 'frond', dx: 0.9, dz: -3.2, variant: 0 },
  { kind: 'vine', dx: 3.9, dz: -1.9, variant: 1 },
  { kind: 'frond', dx: 3.8, dz: 2.4, variant: 1 },
]

/** Where the loam surfaces once the whole pocket is clear — the gaps between
 *  the per-prop discs, so cleared ground reads as one dark bed, not polka dots. */
const POCKET_LOAM: { dx: number; dz: number; r: number }[] = [
  { dx: -1.9, dz: 0.1, r: 1.1 },
  { dx: -0.4, dz: 1.0, r: 1.0 },
  { dx: 0.4, dz: -1.1, r: 1.05 },
  { dx: 1.6, dz: 0.3, r: 1.1 },
  { dx: 2.4, dz: -1.7, r: 0.85 },
  { dx: -2.4, dz: -1.4, r: 0.85 },
]

/**
 * The bougainvillea: ONE mass, on the north lip of the treeline gap.
 *
 * It was five clusters strung along both sides of the mouth, and five splashes
 * of magenta is not an accent, it is a colour scheme — the eye counted them,
 * priced them as decoration, and walked past. The spec asks for a *splash*: the
 * single non-green, non-sand colour in the frame, the bridge element that says
 * a Mediterranean village will one day spill over whitewashed walls the way
 * this spills over the jungle's edge.
 *
 * So one cluster, richer than any of the five were, cascading down the lip and
 * into the mouth: tall and high at the back, tumbling smaller and lower as it
 * comes over the edge. Asymmetric on purpose — flowers either side of a doorway
 * is a gatepost, and a gatepost is an arrow.
 *
 * The walking corridor (|z| < 1.6) stays clear, as does the whole south lip.
 */
const GAP_SPILL: { x: number; z: number; variant: number; scale: number; lift: number }[] = [
  { x: -41.0, z: 3.6, variant: 0, scale: 1.55, lift: 0.5 },
  { x: -40.4, z: 4.0, variant: 4, scale: 1.35, lift: 0.34 },
  { x: -40.3, z: 2.8, variant: 1, scale: 1.3, lift: 0.26 },
  { x: -39.7, z: 3.3, variant: 3, scale: 1.05, lift: 0.14 },
  { x: -39.5, z: 2.2, variant: 2, scale: 0.95, lift: 0.02 },
]

/** Seconds a litter piece takes to shrink away after its prop clears. */
const LITTER_FADE = 0.4
/** Opacity per second the loam discs surface at. */
const LOAM_FADE = 2.2

interface Entry {
  id: string
  kind: ChaosKind
  required: boolean
  pos: THREE.Vector3
  rig: ChaosPropRig
  obstacle: Obstacle
  loam: Loam
  cleared: boolean
}

interface Loam {
  mesh: THREE.Mesh
  material: THREE.MeshLambertMaterial
  target: number
}

interface Litter {
  mesh: THREE.Mesh
  baseScale: THREE.Vector3
  /** Index into entries[] of the prop whose clearing sweeps this piece. */
  near: number
  /** -1 until its prop clears, then seconds into the shrink. */
  t: number
}

/**
 * A patch of cleared ground, conforming to the terrain under it.
 *
 * This used to be a flat tilted disc of near-black lambert, which on screen was
 * the single ugliest thing in the opening: a hard-edged void that read as a
 * shadow bug rather than as soil. The patch builder in `assets/opening/loam`
 * owns the whole problem now — noisy outline, feathered alpha rim, world-space
 * grain so overlapping patches share one continuous bed, and a value ramp
 * authored pre-light so dawn does not crush it to black. Everything here still
 * conforms to `groundHeight` per vertex; terrain stays baked and untouched.
 *
 * The `color` argument is kept for call-site compatibility: the loam ramp is
 * authored inside the patch builder, where the lighting maths lives.
 */
function conformingDisc(x: number, z: number, r: number, color: number, lift: number): Loam {
  void color
  const patch = createLoamPatch({
    centre: new THREE.Vector3(x, 0, z),
    w: r * 2.6,
    d: r * 2.45,
    seed: Math.round(x * 71 + z * 137 + r * 1000),
    lift,
  })
  patch.setOpacity(0)
  return { mesh: patch.mesh, material: patch.material, target: 0 }
}

/** Dark volcanic loam — the cleared-ground colour, a shade above black so the
 *  1.2-saturation grade has nothing to push. */
const LOAM_COLOR = 0x33281e
/** Dead-leaf litter tones for the choked state: dull, dry, deliberately
 *  un-lush so the living chaos props read as the things to grab. */
const LITTER_COLORS = [0x6b5a3c, 0x596b39, 0x7a6a4a]

export class ChaosPocket {
  readonly centre: THREE.Vector3

  private readonly group = new THREE.Group()
  private readonly entries: Entry[] = []
  private readonly litter: Litter[] = []
  private readonly pocketLoam: Loam[] = []
  private voluntary = 0
  private pocketFired = false

  /** Fired on every hold-clear with the payout; `voluntary` marks rim extras. */
  onClear?: (at: THREE.Vector3, kind: ChaosKind, drop: ChaosDrop, voluntary: boolean) => void
  /** Fired once, when the last REQUIRED object goes — the island's breath cue. */
  onPocketCleared?: (centre: THREE.Vector3) => void

  constructor(scene: THREE.Group, obstacles: Obstacle[], rand: () => number) {
    this.centre = new THREE.Vector3(CENTRE_X, groundHeight(CENTRE_X, CENTRE_Z), CENTRE_Z)

    const place = (
      spot: { kind: ChaosKind; dx: number; dz: number; variant: number },
      required: boolean,
      index: number,
    ) => {
      const x = CENTRE_X + spot.dx
      const z = CENTRE_Z + spot.dz
      const rig = createChaosProp(spot.kind, spot.variant)
      rig.root.position.set(x, groundHeight(x, z), z)
      rig.root.rotation.y += (rand() - 0.5) * 0.6
      this.group.add(rig.root)

      const obstacle: Obstacle = { x, z, r: OBSTACLE_R[spot.kind] }
      obstacles.push(obstacle)

      const loam = conformingDisc(x, z, 0.55 + rand() * 0.25, LOAM_COLOR, 0.025 + index * 0.003)
      this.group.add(loam.mesh)

      this.entries.push({
        id: `chaos-${required ? '' : 'x-'}${spot.kind}-${index}`,
        kind: spot.kind,
        required,
        pos: new THREE.Vector3(x, groundHeight(x, z), z),
        rig,
        obstacle,
        loam,
        cleared: false,
      })
    }

    REQUIRED.forEach((spot, i) => place(spot, true, i))
    VOLUNTARY.forEach((spot, i) => place(spot, false, REQUIRED.length + i))

    // The wild-state ground story: dry leaves and twig-bits strewn through the
    // footprint, each assigned to its nearest prop so clearing a tangle also
    // tidies the ground it was choking.
    for (let i = 0; i < 26; i++) {
      const dx = (rand() - 0.5) * 7.2
      const dz = (rand() - 0.5) * 5.2
      const x = CENTRE_X + dx
      const z = CENTRE_Z + dz
      const twig = rand() < 0.3
      const mesh = twig
        ? cyl(0.012, 0.018, 0.25 + rand() * 0.25, LITTER_COLORS[0], 4)
        : ball(0.05 + rand() * 0.045, LITTER_COLORS[Math.floor(rand() * LITTER_COLORS.length)], 1)
      if (twig) {
        mesh.rotation.z = Math.PI / 2
        mesh.rotation.y = rand() * Math.PI * 2
      } else {
        mesh.scale.set(1.35, 0.16, 1)
        mesh.rotation.y = rand() * Math.PI * 2
      }
      mesh.position.set(x, groundHeight(x, z) + 0.03, z)
      mesh.castShadow = false
      setLayer(mesh, MINOR_LAYER)
      this.group.add(mesh)

      let near = 0
      let bestD = Infinity
      for (let e = 0; e < this.entries.length; e++) {
        const d = this.entries[e].pos.distanceToSquared(mesh.position)
        if (d < bestD) {
          bestD = d
          near = e
        }
      }
      this.litter.push({ mesh, baseScale: mesh.scale.clone(), near, t: -1 })
    }

    // The pocket-wide loam bed, revealed only when the whole pocket clears.
    for (const spot of POCKET_LOAM) {
      const loam = conformingDisc(
        CENTRE_X + spot.dx,
        CENTRE_Z + spot.dz,
        spot.r,
        LOAM_COLOR,
        0.02,
      )
      this.pocketLoam.push(loam)
      this.group.add(loam.mesh)
    }

    // Treeline-gap dressing rides along with the pocket (contract §5.1).
    // `lift` stacks the cluster up the bank of the jungle lip and back down
    // into the mouth; the pieces overlap enough that the mound reads as one
    // plant whether or not the jungle wall is standing behind it.
    for (const spill of GAP_SPILL) {
      const g = createBougainvilleaSpill(spill.variant)
      g.position.set(spill.x, groundHeight(spill.x, spill.z) + spill.lift, spill.z)
      g.scale.multiplyScalar(spill.scale)
      this.group.add(g)
    }

    scene.add(this.group)
  }

  get requiredLeft(): number {
    let n = 0
    for (const e of this.entries) if (e.required && !e.cleared) n++
    return n
  }

  /** All REQUIRED objects gone. Voluntary extras never gate this. */
  get cleared(): boolean {
    return this.requiredLeft === 0
  }

  /** The thesis metric: rim extras cleared unprompted. */
  get voluntaryCleared(): number {
    return this.voluntary
  }

  /**
   * Hold targets for every standing hold-clearable object.
   *
   * Rebuilt per call — the closures pin their entry, so a stale array held by
   * HoldInput across a clear simply finds `cleared` already true and no-ops.
   */
  holdTargets(): HoldTarget[] {
    const targets: HoldTarget[] = []
    for (const entry of this.entries) {
      if (entry.cleared || entry.kind === 'amphora') continue
      targets.push({
        id: entry.id,
        kind: 'chaos',
        pos: entry.pos,
        radius: HOLD_RADIUS,
        duration: HOLD_DURATION[entry.kind],
        verb: 'clear',
        onProgress: (t) => entry.rig.setStrain(t),
        onCancel: () => entry.rig.setStrain(0),
        onComplete: () => {
          const drop = this.clearEntry(entry)
          if (drop) this.onClear?.(entry.pos.clone(), entry.kind, drop, !entry.required)
        },
      })
    }
    return targets
  }

  /**
   * The amphora shard's tap-collect. Returns the collectable if the player is
   * within reach of a standing shard, else null. `collect()` returns the drop
   * directly — it does NOT also fire `onClear`, so the caller is the single
   * granting channel and nothing can be credited twice.
   */
  tapTargetNear(pos: THREE.Vector3): { id: string; collect: () => ChaosDrop } | null {
    for (const entry of this.entries) {
      if (entry.kind !== 'amphora' || entry.cleared) continue
      if (Math.hypot(entry.pos.x - pos.x, entry.pos.z - pos.z) > TAP_REACH) continue
      return {
        id: entry.id,
        collect: () => this.clearEntry(entry) ?? dropFor('amphora'),
      }
    }
    return null
  }

  /**
   * Retire one object: collider off (never spliced — Clearing's rule), exit
   * animation, ground tidied, metrics advanced, and the island's-breath cue
   * fired exactly once when the last required object goes.
   */
  private clearEntry(entry: Entry): ChaosDrop | null {
    if (entry.cleared) return null
    entry.cleared = true
    entry.obstacle.off = true
    entry.rig.setStrain(0)
    entry.rig.playClear()
    entry.loam.target = 1
    for (const l of this.litter) {
      if (l.t < 0 && this.entries[l.near] === entry) l.t = 0
    }
    if (!entry.required) this.voluntary++
    const drop = dropFor(entry.kind)
    if (this.cleared && !this.pocketFired) {
      this.pocketFired = true
      for (const loam of this.pocketLoam) loam.target = 1
      this.onPocketCleared?.(this.centre.clone())
    }
    return drop
  }

  update(dt: number, elapsed: number) {
    for (const entry of this.entries) entry.rig.update(dt, elapsed)

    for (const l of this.litter) {
      if (l.t < 0 || !l.mesh.visible) continue
      l.t += dt
      const p = Math.min(1, l.t / LITTER_FADE)
      l.mesh.scale.copy(l.baseScale).multiplyScalar(Math.max(0.001, 1 - p))
      if (p >= 1) l.mesh.visible = false
    }

    const step = LOAM_FADE * dt
    for (const entry of this.entries) fadeLoam(entry.loam, step)
    for (const loam of this.pocketLoam) fadeLoam(loam, step)
  }

  /**
   * Idempotent staging for resume/jumpTo: put the pocket into its cleared
   * state instantly — no animations, no callbacks, no drops. Voluntary rim
   * extras are left standing (their count lives in the opening record; the
   * props themselves remain clearable, which is the point of them).
   */
  restore(state: { cleared: boolean }) {
    if (!state.cleared) return
    for (const entry of this.entries) {
      if (!entry.required || entry.cleared) continue
      entry.cleared = true
      entry.obstacle.off = true
      entry.rig.root.visible = false
      entry.loam.target = 1
      entry.loam.material.opacity = 1
      for (const l of this.litter) {
        if (this.entries[l.near] === entry) {
          l.t = LITTER_FADE
          l.mesh.visible = false
        }
      }
    }
    this.pocketFired = true
    for (const loam of this.pocketLoam) {
      loam.target = 1
      loam.material.opacity = 1
    }
  }
}

function fadeLoam(loam: Loam, step: number) {
  const o = loam.material.opacity
  if (o >= loam.target) return
  loam.material.opacity = Math.min(loam.target, o + step)
}
