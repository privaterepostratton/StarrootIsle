import * as THREE from 'three'
import { groundHeight, heightAt, isSand, WATER_LEVEL } from '../terrain'
import type { TideDrop } from './types'
import { createWashupProp } from '../../assets/opening/beach-models'

/**
 * The tide line — three scripted washups on the wet sand near the wake spot.
 *
 * Beat 7 teaches the beach as a gift surface *before the tide is ever named*:
 * while the first crop's sundial runs, three small things lie glinting on the
 * wet band below the spawn, tap-collected with the one word "Pick." Session
 * two turns the line over with a second set, one of which — sea-glass in an
 * impossible colour — is the player's first small lotto outside the farm.
 *
 * This class is scripted staging, not the Flotsam system: the washup *spots*
 * are fixed anchors computed once (marched seaward from known dry points to
 * the wet band), the items are placed by `spawnSet`, and nothing here runs a
 * timer. The real `Flotsam` stays dormant until the opening ends (its gate is
 * the integrator's), and it will inherit this exact walk-up-and-take grammar.
 *
 * The wet band itself is paint, not terrain: heights are baked (contract risk
 * 6), so each anchor gets a small caramel decal quad whose vertices conform to
 * `heightAt` — small on purpose, because the beach is not flat and a large
 * decal would shear off the surface at its corners.
 */

/** Dry-sand march origins (contract §2.5); seaward is away from the origin. */
const MARCH_STARTS: { x: number; z: number }[] = [
  { x: -58, z: 2 },
  { x: -57, z: 9 },
  { x: -60, z: -3 },
]

/** March until the ground drops to here: the wet band, a hand above the sea. */
const TARGET_H = WATER_LEVEL + 0.25
/** March resolution and give-up distance. */
const MARCH_STEP = 0.25
const MARCH_MAX = 24

/** Tap-collect forgiveness (contract §2.5). */
const COLLECT_RANGE = 1.8

/** Wet-sand caramel (spec palette; contract §5.1 — W-BEACH owns this colour). */
const WET_CARAMEL = 0xc9a97a
/** The band's soaked seaward edge: caramel with the light gone out of it. */
const WET_CARAMEL_DEEP = 0xa8875c
/** The foam lip — warm white, never the cold blue-white of the water shader. */
const FOAM_IVORY = 0xf7f1e2

/**
 * Band geometry, in world units up and down the beach from the waterline.
 *
 * The first pass painted three 3.4 × 1.9 patches, one under each washup, and
 * on screen they read as three unrelated stains rather than as a tide. The
 * beach only says *tide* when the wet is a continuous band that follows the
 * shoreline's curve, so this is built as one arc strip spanning the whole
 * washup arc with margin at both ends.
 */
const BAND_UP = 4.2
const BAND_DOWN = 1.6
/** Extra arc past the outermost anchor, in radians (~5 units at this radius). */
const BAND_ARC_PAD = 0.1
/** Samples across the arc; enough that the curve never faceted-reads. */
const BAND_SAMPLES = 72
/** Foam lip half-width, and how far its scallops wander up/down the beach. */
const FOAM_HALF = 0.5
const FOAM_WANDER = 0.34
/** Skin offsets above the baked terrain, wet band then foam on top of it. */
const WET_SKIN = 0.035
const FOAM_SKIN = 0.055
/** Radial search window for the waterline, either side of the anchors. */
const BAND_SEARCH_IN = 7
const BAND_SEARCH_OUT = 14
const BAND_SEARCH_STEP = 0.2

/** The two scripted sets, one id per anchor, in anchor order. */
const SETS: Record<1 | 2, TideDrop['id'][]> = {
  1: ['spiral-shell', 'sea-glass', 'driftwood-stick'],
  2: ['rope-coil', 'odd-fruit', 'impossible-glass'],
}

interface Anchor {
  x: number
  z: number
  /** Unit seaward direction — used to jitter items and orient the decal. */
  dir: THREE.Vector2
}

interface Washup {
  object: THREE.Group
  id: TideDrop['id']
  x: number
  z: number
  baseY: number
  /** Phase offset so the three never bob in lockstep (beach-seeds precedent). */
  phase: number
  taken: boolean
}

export class Tideline {
  private readonly group = new THREE.Group()
  private readonly anchors: Anchor[] = []
  private readonly items: Washup[] = []
  private readonly rng: () => number

  /** Fires per pick, after the item leaves the world. */
  onCollect?: (at: THREE.Vector3, drop: TideDrop) => void

  constructor(scene: THREE.Group, rng: () => number) {
    this.rng = rng
    scene.add(this.group)

    for (const start of MARCH_STARTS) {
      this.anchors.push(this.marchSeaward(start.x, start.z))
    }
    for (const mesh of this.buildWetBand()) this.group.add(mesh)
  }

  /**
   * Walk from a dry start point straight away from the island's centre until
   * the ground reaches the wet band. "Away from centre" is the seaward
   * direction everywhere on this radial island — the same reasoning as
   * Flotsam.findSpot's furthest-from-middle pick, but deterministic, because
   * these three spots are staged and must land in the same place every boot.
   *
   * If the march never quite reaches the band (a dune ridge in the way), the
   * lowest sandy point seen wins — a washup slightly up-beach is fine; a
   * washup underwater or missing entirely is not.
   */
  private marchSeaward(sx: number, sz: number): Anchor {
    const len = Math.hypot(sx, sz)
    const dir = new THREE.Vector2(sx / len, sz / len)
    let best = { x: sx, z: sz, h: heightAt(sx, sz) }
    for (let d = 0; d <= MARCH_MAX; d += MARCH_STEP) {
      const x = sx + dir.x * d
      const z = sz + dir.y * d
      const h = heightAt(x, z)
      if (!isSand(x, z)) continue
      if (h <= TARGET_H) return { x, z, dir }
      if (h < best.h) best = { x, z, h }
    }
    return { x: best.x, z: best.z, dir }
  }

  /**
   * The wet band: one caramel strip that follows the shoreline, plus the foam
   * lip that breaks along its seaward edge.
   *
   * Still the conforming-decal approach — terrain heights are baked (contract
   * risk 6) and nothing here touches them — but built as an *arc* rather than
   * as three loose quads. This island is radial, so the shoreline at a given
   * angle is simply the radius at which the ground drops to the waterline;
   * sampling that radius across the washup arc gives a curve that hugs the
   * real beach, and laying rows of vertices up and down the beach from it
   * gives a band with a gradient across it.
   *
   * The gradient matters more than the width. Wet sand is not a flat colour
   * patch: it is dry ivory that darkens as it goes down the slope and is
   * soaking by the time it meets the water. So the up-beach row is caramel at
   * zero alpha (an invisible feather into the dry sand — no cut line), the
   * middle rows carry the caramel proper, and the seaward row is the deeper,
   * light-drained caramel at nearly full opacity. That ramp is what the first
   * pass was missing: its patches had one colour and a hard edge, so they read
   * as stains, and the tide band was "barely distinguishable" from the dry
   * beach it was supposed to be the counterpoint to.
   */
  private buildWetBand(): THREE.Mesh[] {
    // Sample the waterline radius across the arc the anchors occupy.
    const base = Math.atan2(this.anchors[0].z, this.anchors[0].x)
    const angles = this.anchors.map((a) => {
      let t = Math.atan2(a.z, a.x)
      // Unwrap toward the first anchor — this arc straddles ±π.
      while (t - base > Math.PI) t -= Math.PI * 2
      while (base - t > Math.PI) t += Math.PI * 2
      return t
    })
    const radii = this.anchors.map((a) => Math.hypot(a.x, a.z))
    const a0 = Math.min(...angles) - BAND_ARC_PAD
    const a1 = Math.max(...angles) + BAND_ARC_PAD
    const rMid = radii.reduce((s, r) => s + r, 0) / radii.length

    const shoreR: number[] = []
    let last = rMid
    for (let i = 0; i <= BAND_SAMPLES; i++) {
      const a = a0 + ((a1 - a0) * i) / BAND_SAMPLES
      shoreR.push(this.waterlineRadius(a, last))
      last = shoreR[shoreR.length - 1]
    }
    // Three-tap smooth: the height field is noisy at this resolution and an
    // unsmoothed waterline reads as a torn edge rather than as a shore.
    const shore = shoreR.map((r, i) => {
      const p = shoreR[Math.max(0, i - 1)]
      const n = shoreR[Math.min(shoreR.length - 1, i + 1)]
      return (p + r * 2 + n) * 0.25
    })

    // Rows across the beach: radial offset, colour, alpha.
    const rows: { off: number; color: THREE.Color; alpha: number }[] = [
      { off: -BAND_UP, color: new THREE.Color(WET_CARAMEL), alpha: 0 },
      { off: -BAND_UP * 0.55, color: new THREE.Color(WET_CARAMEL), alpha: 0.34 },
      { off: -BAND_UP * 0.2, color: new THREE.Color(WET_CARAMEL), alpha: 0.72 },
      { off: 0.05, color: new THREE.Color(WET_CARAMEL_DEEP), alpha: 0.92 },
      { off: BAND_DOWN, color: new THREE.Color(WET_CARAMEL_DEEP), alpha: 0.88 },
    ]

    const wet = this.stripMesh(a0, a1, shore, rows, WET_SKIN, false)
    wet.receiveShadow = true

    /*
     * The foam lip. A thin bright strip riding the waterline, its centre
     * wandering up and down the beach on two out-of-phase sines so it scallops
     * the way a wash does instead of ruling a line, and its brightness rising
     * and falling along the arc so some scallops read as breaking and others
     * as spent. Warm white — the sea's own foam colour lives in the water
     * shader and is cold; on the sand, at this hour, foam is lit by the same
     * dawn key as everything else.
     */
    const foamRows: { off: number; color: THREE.Color; alpha: number }[] = [
      { off: -FOAM_HALF, color: new THREE.Color(FOAM_IVORY), alpha: 0 },
      { off: -FOAM_HALF * 0.3, color: new THREE.Color(FOAM_IVORY), alpha: 0.85 },
      { off: FOAM_HALF * 0.25, color: new THREE.Color(FOAM_IVORY), alpha: 0.7 },
      { off: FOAM_HALF, color: new THREE.Color(FOAM_IVORY), alpha: 0 },
    ]
    const foam = this.stripMesh(a0, a1, shore, foamRows, FOAM_SKIN, true)
    foam.renderOrder = 2

    return [wet, foam]
  }

  /**
   * March outward at a fixed angle to find the radius where the ground drops
   * to the wet band. Seeded from the previous sample's answer so the search
   * window travels with the shoreline instead of being fixed to the mean.
   */
  private waterlineRadius(angle: number, seed: number): number {
    const cx = Math.cos(angle)
    const cz = Math.sin(angle)
    for (let r = seed - BAND_SEARCH_IN; r <= seed + BAND_SEARCH_OUT; r += BAND_SEARCH_STEP) {
      if (heightAt(cx * r, cz * r) <= TARGET_H) return r
    }
    return seed
  }

  /**
   * Build one conforming arc strip. Rows run along the shoreline, columns up
   * and down the beach; every vertex is dropped onto `heightAt` plus a skin,
   * and per-vertex RGBA carries the across-beach gradient so one draw call
   * covers the whole feather. Polygon offset keeps the sliver off the sand.
   */
  private stripMesh(
    a0: number,
    a1: number,
    shore: number[],
    rows: { off: number; color: THREE.Color; alpha: number }[],
    skin: number,
    scallop: boolean,
  ): THREE.Mesh {
    const cols = shore.length
    const count = cols * rows.length
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 4)

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri]
      for (let ci = 0; ci < cols; ci++) {
        const a = a0 + ((a1 - a0) * ci) / (cols - 1)
        // Scalloped edges wander; the wet band's do not (it is the whole
        // soaked zone, and a wobbling inner edge would read as a mistake).
        const wander = scallop
          ? Math.sin(ci * 0.42) * FOAM_WANDER + Math.sin(ci * 0.17 + 1.3) * FOAM_WANDER * 0.6
          : 0
        const r = shore[ci] + row.off + wander
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        const i = ri * cols + ci
        positions[i * 3] = x
        positions[i * 3 + 1] = heightAt(x, z) + skin
        positions[i * 3 + 2] = z
        // Along-arc brightness variation so the lip breathes rather than
        // running at one strength for twenty units.
        const vary = scallop ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ci * 0.31 + 0.7)) : 1
        colors[i * 4] = row.color.r
        colors[i * 4 + 1] = row.color.g
        colors[i * 4 + 2] = row.color.b
        colors[i * 4 + 3] = row.alpha * vary
      }
    }

    const indices: number[] = []
    for (let ri = 0; ri < rows.length - 1; ri++) {
      for (let ci = 0; ci < cols - 1; ci++) {
        const a = ri * cols + ci
        const b = a + 1
        const c = a + cols
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    geo.setIndex(indices)
    geo.computeVertexNormals()

    return new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )
  }

  /**
   * Stage a washup set: 1 = the beat-7 trio, 2 = the first-return trio with
   * the impossible glass. Idempotent for resume/jumpTo — any items already on
   * the sand are swept first, so replaying staging never doubles them up.
   */
  spawnSet(set: 1 | 2): void {
    this.clear()
    for (const [i, id] of SETS[set].entries()) {
      const anchor = this.anchors[i]
      const along = new THREE.Vector2(-anchor.dir.y, anchor.dir.x)
      // Jitter along the shoreline so the line reads scattered, not planted.
      const u = (this.rng() - 0.5) * 1.6
      const v = (this.rng() - 0.5) * 0.5
      const x = anchor.x + along.x * u + anchor.dir.x * v
      const z = anchor.z + along.y * u + anchor.dir.y * v

      const object = createWashupProp(id)
      const baseY = groundHeight(x, z)
      object.position.set(x, baseY, z)
      object.rotation.y = this.rng() * Math.PI * 2
      this.group.add(object)
      this.items.push({ object, id, x, z, baseY, phase: this.rng() * Math.PI * 2, taken: false })
    }
  }

  get remaining() {
    return this.items.filter((i) => !i.taken).length
  }

  /**
   * Tap-collect: the nearest standing washup within reach of `pos`, or null.
   * `collect` removes the item, fires onCollect, and returns the drop —
   * the caller (W-INT's tap router) owns what the drop *does*.
   */
  targetNear(pos: THREE.Vector3): { id: string; at: THREE.Vector3; collect: () => TideDrop } | null {
    let best: Washup | null = null
    let bestDist = COLLECT_RANGE
    for (const item of this.items) {
      if (item.taken) continue
      const d = Math.hypot(item.x - pos.x, item.z - pos.z)
      if (d > bestDist) continue
      bestDist = d
      best = item
    }
    if (!best) return null
    const found = best
    const at = new THREE.Vector3(found.x, found.baseY + 0.4, found.z)
    return {
      id: found.id,
      at,
      collect: () => {
        const drop: TideDrop = { id: found.id, lotto: found.id === 'impossible-glass' }
        if (!found.taken) {
          found.taken = true
          this.group.remove(found.object)
          this.onCollect?.(at.clone(), drop)
        }
        return drop
      },
    }
  }

  /** Standing washup positions — for pulse markers / session-2 glints. */
  positions(): THREE.Vector3[] {
    return this.items
      .filter((i) => !i.taken)
      .map((i) => new THREE.Vector3(i.x, i.baseY + 0.4, i.z))
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3): void {
    void dt
    void playerPos // tap-collected, not walked over — the tap router decides.
    for (const item of this.items) {
      if (item.taken) continue
      /*
       * The gentle bob-and-glint idle: the beach-seeds trick — on an
       * otherwise still beach, a slow rise and fall is most of what makes a
       * small object catch the eye. The breathing scale stands in for a
       * glint without spending a sparkle (and without going anywhere near
       * gold: markers are the UI's job, in ivory).
       */
      item.object.position.y = item.baseY + 0.04 + Math.sin(elapsed * 2 + item.phase) * 0.05
      const s = 1 + Math.sin(elapsed * 3.1 + item.phase * 2) * 0.03
      item.object.scale.setScalar(s)
    }
  }

  /** Sweep all washups (collected or not). The wet-band decals stay — they
   *  are the tide's paint on the beach, not part of any one set. */
  clear(): void {
    for (const item of this.items) {
      if (!item.taken) this.group.remove(item.object)
    }
    this.items.length = 0
  }
}
