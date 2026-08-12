import * as THREE from 'three'
import { ball, cyl, mat, rng } from '../style'

/**
 * The jungle wall's parts kit (spec asset manifest, environment 5–8).
 *
 * The opening's island is Maui, not a park: the treeline is not a row of trees
 * standing on a lawn, it is a *wall* — something the eye reads as solid before
 * it reads as plants, with one doorway cut in it. Everything in this file
 * exists to build that wall out of three ranks of overlapping mass:
 *
 *   back  — tall dark canopy at `canopyShade`/`canopyDeep`, the thing that
 *           stops sky and sea getting through between the crowns;
 *   mid   — broadleaf/monstera clumps at `broadleaf`, the layer that gives the
 *           wall a middle and keeps it from reading as cardboard;
 *   front — fronds and ferns at `frondSun`, catching the low dawn light, the
 *           only rank that moves.
 *
 * The value range is the whole art direction. A jungle that is one green is a
 * hedge; a jungle that runs from near-black shade to a lit frond tip is depth.
 * The ramp below is deliberately deep at the bottom and sunlit — never olive —
 * at the top, and every module picks its lobe colours by height so a single
 * module already carries part of the gradient.
 *
 * Colour note: postfx multiplies saturation by 1.2, so every green here is
 * authored a notch under its spec value and lands on it after the grade. The
 * spec anchors are `#2E6B3A` (deep) and `#8FCF6B` (sunlit).
 *
 * Build note: every module is a plain `THREE.Group` of `mat()`-coloured meshes
 * so `bakeGroup` can flatten it to one vertex-coloured geometry and the wall
 * can draw a few hundred of them as a handful of instanced calls. Nothing here
 * animates on its own — the front rank's trade-wind sway is a vertex shader in
 * jungle-wall.ts, because per-object motion and instancing are mutually
 * exclusive and instancing is what makes the density affordable.
 *
 * NO gold anywhere in this file. `LOTTO_GOLD` means luck, and the environment
 * never gets to say it.
 */

export const JUNGLE_PALETTE = {
  /** Deepest shade — undersides, understory, the back of the wall. */
  canopyShade: 0x23502f,
  /** Spec's deep jungle green. The back rank's working colour. */
  canopyDeep: 0x2e6b3a,
  canopyMid: 0x3f8244,
  broadleaf: 0x53944c,
  broadleafLit: 0x6fb35a,
  /** Spec's sunlit green, a notch under for the 1.2 grade. */
  frondSun: 0x86c468,
  frondPale: 0x9ad07c,
  vineLeaf: 0x40794a,
  trunkDark: 0x40342a,
  trunk: 0x574636,
  trunkPale: 0x6d5a45,
  /** Volcanic rock, spec `#2A2622`. */
  basalt: 0x2a2622,
  basaltLit: 0x38332d,
  /** Salt crust: bleached, cool, and pointedly not gold. */
  saltCrust: 0xdcd8cd,
} as const

const P = JUNGLE_PALETTE

/**
 * The deep→sunlit ramp, sampled by height within a module.
 *
 * Weighted toward the dark end — two stops of deep before it starts climbing —
 * because the wall's job is to be a dark mass with light on top of it. An
 * evenly spaced ramp gives a bush that is uniformly medium green, which is the
 * hedge this whole file exists to avoid.
 */
const CANOPY_RAMP = [
  P.canopyShade,
  P.canopyDeep,
  P.canopyDeep,
  P.canopyMid,
  P.broadleaf,
  P.broadleafLit,
]

/**
 * Pick a canopy tone for a lobe sitting at height ratio `t` (0 = ground, 1 =
 * crown top), nudged by `jitter` so neighbouring lobes never match exactly.
 *
 * Doing this by height rather than at random is what gives a single crown its
 * own light: the shaded belly reads as depth behind the lit cap, and at wall
 * density those bellies join up into the dark mass the whole design rests on.
 */
function canopyTone(t: number, jitter: number): number {
  const i = Math.round(
    Math.min(CANOPY_RAMP.length - 1, Math.max(0, t * (CANOPY_RAMP.length - 1) + jitter)),
  )
  return CANOPY_RAMP[i]
}

/**
 * One leaf: a tapered blade that droops as it reaches out.
 *
 * Built by hand rather than from a plane because a leaf's silhouette is the
 * entire asset at this scale — a rectangle reads as a flag, and a leaf with a
 * rounded shoulder and a point reads as a leaf even at eight pixels across.
 *
 * The normals are forced straight up, the same trick the tree impostors use:
 * foliage lit like ground keeps its value as the camera swings, where a real
 * per-face normal makes half the wall flare white and the other half go black.
 */
function leafMesh(len: number, wid: number, droop: number, color: number, segs = 4): THREE.Mesh {
  const pos: number[] = []
  const nor: number[] = []
  // Rounded at the shoulder, tapering to a point — sin() over a shifted domain
  // so the base is already wide instead of pinching to nothing at the stem.
  const widthAt = (t: number) => (wid / 2) * Math.sin(Math.PI * Math.min(1, 0.16 + t * 0.9))
  const push = (t: number, side: number) => {
    pos.push(side * widthAt(t), -droop * t * t, t * len)
    nor.push(0, 1, 0)
  }
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs
    const t1 = (i + 1) / segs
    if (i === segs - 1) {
      push(t0, -1)
      push(t0, 1)
      push(t1, 0)
    } else {
      push(t0, -1)
      push(t0, 1)
      push(t1, 1)
      push(t0, -1)
      push(t1, 1)
      push(t1, -1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return new THREE.Mesh(geo, mat(color))
}

/** Place a leaf on a bearing, tilted up by `pitch`, rooted at `y`. */
function sprig(
  parent: THREE.Group,
  leaf: THREE.Mesh,
  bearing: number,
  pitch: number,
  y: number,
  out = 0,
) {
  leaf.position.set(Math.cos(bearing) * out, y, Math.sin(bearing) * out)
  leaf.rotation.order = 'YXZ'
  leaf.rotation.y = -bearing
  leaf.rotation.x = pitch
  parent.add(leaf)
}

// --- module A: dense canopy ---------------------------------------------------

/**
 * Jungle wall module A — the dense one (~9.5 units tall, authored at scale 1).
 *
 * A single heavy trunk carrying a tall column of overlapping lobes, plus an
 * *understory* mass at knee-to-shoulder height. The understory is the part
 * that matters: a crown alone leaves a metre of daylight under every tree, and
 * a treeline you can see the sea beneath is not a wall. Half the lobes in this
 * module exist below head height for exactly that reason.
 */
export function createJungleCanopyA(variant: number): THREE.Group {
  const r = rng(1700 + variant * 97)
  const g = new THREE.Group()

  const lean = (r() - 0.5) * 0.16
  const trunkH = 5.4 + r() * 1.4
  const trunk = cyl(0.26, 0.52, trunkH, P.trunk, 6)
  trunk.position.set(0, trunkH / 2, 0)
  trunk.rotation.z = lean
  g.add(trunk)

  // Buttress roots — the Maui banyan tell, and they close the last sliver of
  // daylight at the very bottom of the trunk.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r()
    const root = cyl(0.06, 0.3, 1.1, P.trunkDark, 5)
    root.position.set(Math.cos(a) * 0.34, 0.5, Math.sin(a) * 0.34)
    root.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35)
    g.add(root)
  }

  /*
   * Crown: flattened lobes for mass, big leaves for outline.
   *
   * The lobes alone were the first version and they read as broccoli — a wall
   * of spheres has a bubbled edge, and a bubbled edge against a dawn sky says
   * "shrub" no matter how dark it is. What makes a canopy read as jungle is the
   * *outline*: long leaves sticking out past the mass at every angle, so the
   * silhouette is ragged and pointed. So the lobes are squashed to half height
   * and pushed inward to be filler, and the leaves are the asset.
   */
  const crownBase = trunkH - 0.9
  const lobes = 9
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1)
    const y = crownBase + t * 3.4
    const spread = 1.5 * Math.sin(Math.PI * (0.24 + t * 0.7))
    const a = i * 2.399 + r() * 0.6
    const rad = 1.05 + r() * 0.6 - t * 0.2
    const lobe = ball(rad, canopyTone(0.2 + t * 0.8, r() < 0.4 ? -1 : 0), 0)
    lobe.scale.set(1.3, 0.52, 1.3)
    lobe.position.set(Math.cos(a) * spread, y, Math.sin(a) * spread)
    lobe.castShadow = false
    g.add(lobe)
  }

  // The outline: leaves fanning out of the crown, drooping harder the further
  // out they reach. Top ones catch the dawn — the spec's warm rim light.
  //
  // Narrow rather than broad. A wide flat card of one flat colour reads as a
  // shard of coloured glass the moment it turns face-on to the camera, and a
  // wall of them looks shattered; long and slim reads as a leaf from any angle
  // and edge-on simply disappears into the mass, which is what it should do.
  for (let i = 0; i < 20; i++) {
    const t = r()
    const a = i * 2.399 + r() * 0.5
    const y = crownBase + 0.3 + t * 3.3
    const tone = t > 0.8 ? P.broadleafLit : canopyTone(0.3 + t * 0.65, 0)
    const leaf = leafMesh(1.5 + r() * 1.0, 0.48 + r() * 0.26, 0.62 + r() * 0.45, tone, 4)
    leaf.castShadow = false
    sprig(g, leaf, a, -0.05 - r() * 0.55 + t * 0.35, y, 0.5 + r() * 0.65)
  }

  // Understory: the daylight-killer. Nothing gets between these and the ground.
  for (let i = 0; i < 6; i++) {
    const a = i * 1.9 + r()
    const y = 0.7 + r() * 2.3
    const rad = 0.8 + r() * 0.6
    const lobe = ball(rad, canopyTone(0.05 + r() * 0.25, 0), 0)
    lobe.scale.set(1.35, 0.6, 1.35)
    lobe.position.set(Math.cos(a) * (0.7 + r() * 1.1), y, Math.sin(a) * (0.7 + r() * 1.1))
    lobe.castShadow = false
    g.add(lobe)
  }
  for (let i = 0; i < 9; i++) {
    const a = i * 2.399 + r() * 0.6
    const leaf = leafMesh(
      1.3 + r() * 0.9,
      0.7 + r() * 0.34,
      0.45,
      r() < 0.4 ? P.broadleaf : P.canopyMid,
      4,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, -0.1 - r() * 0.5, 0.9 + r() * 2.2, 0.4 + r() * 0.55)
  }

  return g
}

// --- module B: dense variant --------------------------------------------------

/**
 * Jungle wall module B — the dense variant (~7.6 units, wider than it is tall).
 *
 * A multi-stem clump: three trunks splaying from one root with their own
 * smaller crowns. Faceted (`detail 0`) where module A is smooth, which at wall
 * distance reads as a second species rather than as the same tree resized —
 * the eye matches outlines, and two outlines is all it takes to stop a stamped
 * row looking stamped.
 */
export function createJungleCanopyB(variant: number): THREE.Group {
  const r = rng(2600 + variant * 131)
  const g = new THREE.Group()

  const stems = 3
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + r() * 0.8
    const tilt = 0.16 + r() * 0.16
    const h = 4.0 + r() * 1.6
    const trunk = cyl(0.16, 0.3, h, P.trunkDark, 5)
    trunk.position.set(Math.cos(a) * 0.22, h / 2, Math.sin(a) * 0.22)
    trunk.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt)
    g.add(trunk)

    const cx = Math.cos(a) * (0.22 + Math.sin(tilt) * h)
    const cz = Math.sin(a) * (0.22 + Math.sin(tilt) * h)
    const crownY = h * 0.86

    for (let i = 0; i < 4; i++) {
      const t = i / 3
      const rad = 0.9 + r() * 0.5
      const lobe = ball(rad, canopyTone(0.25 + t * 0.7, r() < 0.35 ? -1 : 0), 0)
      lobe.scale.set(1.25, 0.55, 1.25)
      lobe.position.set(cx + (r() - 0.5) * 1.3, crownY + t * 1.5, cz + (r() - 0.5) * 1.3)
      lobe.castShadow = false
      g.add(lobe)
    }

    // Each stem tops out in a fan — the palm/traveller's-tree read, which is
    // what stops module B looking like module A with fewer parts.
    const fan = 7
    for (let i = 0; i < fan; i++) {
      const b = (i / fan) * Math.PI * 2 + r() * 0.4
      const t = r()
      const leaf = leafMesh(
        1.8 + r() * 0.9,
        0.34 + r() * 0.2,
        0.9 + r() * 0.5,
        t > 0.78 ? P.frondSun : t > 0.4 ? P.broadleafLit : P.canopyMid,
        5,
      )
      leaf.castShadow = false
      leaf.position.set(cx, crownY + 0.5 + r() * 1.1, cz)
      leaf.rotation.order = 'YXZ'
      leaf.rotation.y = -b
      leaf.rotation.x = 0.12 - r() * 0.5
      g.add(leaf)
    }
  }

  // Skirt: the clump's own understory, same job as module A's.
  for (let i = 0; i < 7; i++) {
    const a = i * 1.7 + r()
    const rad = 0.75 + r() * 0.5
    const lobe = ball(rad, canopyTone(r() * 0.28, 0), 0)
    lobe.scale.set(1.35, 0.58, 1.35)
    lobe.position.set(Math.cos(a) * (0.9 + r() * 1.2), 0.6 + r() * 1.7, Math.sin(a) * (0.9 + r() * 1.2))
    lobe.castShadow = false
    g.add(lobe)
  }

  for (let i = 0; i < 12; i++) {
    const a = i * 2.399 + r() * 0.5
    const leaf = leafMesh(
      1.4 + r() * 0.9,
      0.68 + r() * 0.3,
      0.5,
      r() < 0.4 ? P.broadleafLit : P.broadleaf,
      4,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, -0.15 - r() * 0.5, 0.9 + r() * 2.4, 0.5 + r() * 0.6)
  }

  return g
}

// --- module C: canopy overhang ------------------------------------------------

/**
 * Jungle wall module C — the overhang (~6.4 units up, ~4 units of reach).
 *
 * A trunk that leans hard off the wall and carries its crown out over open
 * ground, with vines hanging off the reach. Placed at the treeline gap it
 * arches over the mouth and turns a hole in a hedge into a *doorway*: the
 * player walks under something. It is also what the gap's light shafts fall
 * through, which is why the two ship together in the spec.
 *
 * Authored leaning toward +X; the wall rotates it so the reach points inward.
 */
export function createCanopyOverhang(variant: number): THREE.Group {
  const r = rng(3300 + variant * 173)
  const g = new THREE.Group()

  const tilt = 0.62 + r() * 0.16
  const h = 6.6 + r() * 1.0
  const trunk = cyl(0.2, 0.44, h, P.trunk, 6)
  trunk.position.set(Math.sin(tilt) * h * 0.5, Math.cos(tilt) * h * 0.5, 0)
  trunk.rotation.z = -tilt
  g.add(trunk)

  const tipX = Math.sin(tilt) * h
  const tipY = Math.cos(tilt) * h

  // Crown carried out along the lean — flatter and wider than a standing
  // crown, because what it has to do is roof a piece of sky.
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    const rad = 1.0 + r() * 0.55
    const lobe = ball(rad, canopyTone(0.4 + t * 0.6, r() < 0.4 ? -1 : 0), 0)
    lobe.scale.set(1.3, 0.5, 1.3)
    lobe.position.set(
      tipX * (0.55 + t * 0.55) + (r() - 0.5) * 0.9,
      tipY + 0.3 + (r() - 0.5) * 0.8,
      (r() - 0.5) * 2.6,
    )
    lobe.castShadow = false
    g.add(lobe)
  }

  // Big leaves hanging off the underside — the part actually seen from below,
  // and the part that makes the gap feel roofed rather than merely shaded.
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2
    const t = r()
    const leaf = leafMesh(
      1.5 + r() * 0.9,
      0.55 + r() * 0.24,
      0.9,
      t > 0.78 ? P.frondSun : t > 0.4 ? P.broadleaf : P.canopyMid,
      4,
    )
    leaf.castShadow = false
    leaf.position.set(tipX * (0.42 + r() * 0.7), tipY - 0.2 - r() * 0.7, (r() - 0.5) * 2.6)
    leaf.rotation.order = 'YXZ'
    leaf.rotation.y = -a
    leaf.rotation.x = -0.5 - r() * 0.7
    g.add(leaf)
  }

  // Vine strands, the overhang's signature from underneath. Short and leafy:
  // long bare strands read as wires, and this thing hangs over the doorway the
  // player walks under, which is the worst place to have a wire.
  for (let i = 0; i < 5; i++) {
    const drop = 0.9 + r() * 1.2
    const x = tipX * (0.45 + r() * 0.65)
    const z = (r() - 0.5) * 2.2
    const strand = cyl(0.03, 0.045, drop, P.vineLeaf, 4)
    strand.position.set(x, tipY - 0.4 - drop / 2, z)
    strand.castShadow = false
    g.add(strand)
    for (let k = 0; k < 4; k++) {
      const leaf = leafMesh(0.4 + r() * 0.26, 0.22 + r() * 0.1, 0.1, k === 0 ? P.frondSun : P.vineLeaf, 3)
      leaf.castShadow = false
      leaf.position.set(x, tipY - 0.5 - (k / 4) * drop - r() * 0.15, z)
      leaf.rotation.order = 'YXZ'
      leaf.rotation.y = -(r() * Math.PI * 2)
      leaf.rotation.x = -1.15 - r() * 0.4
      g.add(leaf)
    }
  }

  return g
}

// --- the plug -----------------------------------------------------------------

/**
 * Understory thicket, ~2.6 units — the least interesting module here and the
 * one the whole design fails without.
 *
 * Trees have trunks, and trunks have daylight between them. Three ranks of
 * canopy still left a knee-to-chest band of lit grass showing straight through
 * the wall, which is precisely the "you can see the sea through the treeline"
 * failure this is all meant to fix. This is the plug: squat dark mass, no
 * silhouette ambitions, packed tight enough along the spine that the ranks in
 * front of it never have to be dense enough to do the job themselves.
 *
 * It is deliberately the darkest module in the file. Whatever shows through the
 * front rank's gaps should read as depth, not as a hole.
 */
export function createUnderThicket(variant: number): THREE.Group {
  const r = rng(9100 + variant * 211)
  const g = new THREE.Group()

  for (let i = 0; i < 8; i++) {
    const a = i * 2.399 + r() * 0.8
    const rad = 0.75 + r() * 0.6
    const lobe = ball(rad, r() < 0.65 ? P.canopyShade : P.canopyDeep, 0)
    lobe.scale.set(1.45, 0.62, 1.45)
    lobe.position.set(
      Math.cos(a) * (0.35 + r() * 1.15),
      0.42 + r() * 1.5,
      Math.sin(a) * (0.35 + r() * 1.15),
    )
    lobe.castShadow = false
    g.add(lobe)
  }
  // A scatter of leaves so the plug is not a pile of bricks where it does
  // happen to be seen.
  for (let i = 0; i < 10; i++) {
    const a = i * 2.399 + r() * 0.6
    const leaf = leafMesh(
      0.8 + r() * 0.7,
      0.4 + r() * 0.22,
      0.35,
      r() < 0.3 ? P.broadleaf : P.canopyMid,
      3,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, -0.05 - r() * 0.6, 0.4 + r() * 1.5, 0.4 + r() * 0.5)
  }
  return g
}

// --- mid rank: broadleaf ------------------------------------------------------

/**
 * Monstera/banana clump, ~2.6 units. The wall's middle.
 *
 * Big single leaves on short stems, splayed low. Without this rank the wall is
 * a dark mass with a fringe of ferns at its feet and nothing in between, which
 * reads as a painted backdrop the moment the player stands near it.
 */
export function createBroadleafClump(variant: number): THREE.Group {
  const r = rng(4100 + variant * 149)
  const g = new THREE.Group()

  const n = 8 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.7
    const y = 0.2 + r() * 0.55
    const len = 1.15 + r() * 0.85
    const stem = cyl(0.025, 0.04, y * 1.6, P.vineLeaf, 4)
    stem.position.set(Math.cos(a) * 0.1, y * 0.8, Math.sin(a) * 0.1)
    stem.castShadow = false
    g.add(stem)
    const leaf = leafMesh(
      len,
      len * (0.52 + r() * 0.16),
      0.42,
      r() < 0.42 ? P.broadleafLit : r() < 0.7 ? P.broadleaf : P.canopyMid,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, -0.15 - r() * 0.55, y * 1.5, 0.12)
  }
  // A low core so the clump has a body between its leaves.
  for (let i = 0; i < 3; i++) {
    const core = ball(0.4 + r() * 0.2, P.canopyShade, 0)
    core.scale.set(1.2, 0.6, 1.2)
    core.position.set((r() - 0.5) * 0.5, 0.24 + r() * 0.2, (r() - 0.5) * 0.5)
    core.castShadow = false
    g.add(core)
  }
  return g
}

// --- front rank: fronds and ferns ---------------------------------------------

/** Tallest vertex the sway shader has to account for in the front rank. */
export const FROND_MAX_HEIGHT = 2.1

/**
 * Frond fan, ~1.7 units — the sunlit front rank.
 *
 * Long arching blades from one root, the lightest greens in the file. These
 * are the only pieces that move, and they are the only pieces the low dawn sun
 * actually reaches, so between them they carry the whole "alive" read of the
 * wall. Everything behind them is mass; this is the part that breathes.
 */
export function createFrondFan(variant: number): THREE.Group {
  const r = rng(5200 + variant * 167)
  const g = new THREE.Group()

  const n = 7 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8
    const len = 1.25 + r() * 0.75
    const leaf = leafMesh(
      len,
      0.3 + r() * 0.16,
      0.55 + r() * 0.3,
      r() < 0.45 ? P.frondSun : r() < 0.78 ? P.frondPale : P.broadleafLit,
      5,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, 0.5 + r() * 0.45, 0.22 + r() * 0.34, 0.08)
  }
  const heart = ball(0.22, P.canopyDeep, 0)
  heart.scale.y = 0.7
  heart.position.y = 0.16
  heart.castShadow = false
  g.add(heart)
  return g
}

/**
 * Fern tuft, ~0.85 units. Ground cover at the wall's foot, thick enough that
 * the line where jungle meets grass is a tangle rather than a mown edge.
 */
export function createFernTuft(variant: number): THREE.Group {
  const r = rng(6100 + variant * 181)
  const g = new THREE.Group()
  const n = 10 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.9
    const leaf = leafMesh(
      0.6 + r() * 0.5,
      0.17 + r() * 0.1,
      0.3,
      r() < 0.45 ? P.frondSun : r() < 0.72 ? P.frondPale : P.broadleafLit,
      4,
    )
    leaf.castShadow = false
    sprig(g, leaf, a, 0.62 + r() * 0.35, 0.06 + r() * 0.14, 0.05)
  }
  return g
}

/**
 * Vine curtain — a bar of tangle with strands hanging off it, ~3 units of drop.
 *
 * Hung against the mid rank it does the job a real jungle's lianas do: it puts
 * a vertical, irregular element across the horizontal bands of foliage, which
 * is what stops layered planting reading as stage flats.
 */
export function createVineCurtain(variant: number): THREE.Group {
  const r = rng(7300 + variant * 191)
  const g = new THREE.Group()

  const span = 1.5 + r() * 1.1
  const top = 3.0 + r() * 0.8

  // A mat of foliage at the top, so the drape hangs off something rather than
  // appearing out of nowhere — the first version was bare strands starting in
  // mid-air, which read as string, not as a plant.
  for (let i = 0; i < 4; i++) {
    const anchor = ball(0.34 + r() * 0.22, canopyTone(0.15 + r() * 0.3, 0), 0)
    anchor.scale.set(1.4, 0.55, 1.1)
    anchor.position.set((r() - 0.5) * span, top + (r() - 0.5) * 0.3, (r() - 0.5) * 0.5)
    anchor.castShadow = false
    g.add(anchor)
  }

  const strands = 4 + Math.floor(r() * 3)
  for (let i = 0; i < strands; i++) {
    const x = (i / Math.max(1, strands - 1) - 0.5) * span
    const z = (r() - 0.5) * 0.5
    const drop = 0.9 + r() * 1.4
    const strand = cyl(0.03, 0.045, drop, P.vineLeaf, 4)
    strand.position.set(x, top - drop / 2, z)
    strand.castShadow = false
    g.add(strand)
    // Leaves hang *down* the strand and overlap it, so the vine reads as a
    // ribbon of leaves rather than as a pole with plates on it.
    const leaves = 4 + Math.floor(r() * 3)
    for (let k = 0; k < leaves; k++) {
      const y = top - 0.1 - ((k + r() * 0.6) / leaves) * drop
      const leaf = leafMesh(
        0.44 + r() * 0.3,
        0.24 + r() * 0.12,
        0.1,
        k < 2 ? (r() < 0.5 ? P.frondSun : P.broadleafLit) : P.vineLeaf,
        3,
      )
      leaf.castShadow = false
      leaf.position.set(x, y, z)
      leaf.rotation.order = 'YXZ'
      leaf.rotation.y = -(r() * Math.PI * 2)
      // Near-vertical, tipping a little off plumb so the drape has a direction.
      leaf.rotation.x = -1.15 - r() * 0.42
      g.add(leaf)
    }
    // A tuft at the tip weights the strand and stops it fading out to a point.
    const tip = ball(0.12 + r() * 0.08, P.vineLeaf, 0)
    tip.scale.set(1.1, 1.5, 1.1)
    tip.position.set(x, top - drop, z)
    tip.castShadow = false
    g.add(tip)
  }
  return g
}

// --- volcanic rock ------------------------------------------------------------

/**
 * Basalt outcrop with salt crust, ~1.3 units.
 *
 * The one non-green thing at the jungle foot, and it is doing real work: a wall
 * of nothing but green loses its scale, and the near-black of volcanic rock is
 * the darkest value on screen — it re-anchors the range that the grade and the
 * dawn light keep trying to lift. Angular, never rounded: this is lava, and the
 * game's other rocks are river stones.
 */
export function createBasaltOutcrop(variant: number): THREE.Group {
  const r = rng(8400 + variant * 199)
  const g = new THREE.Group()

  const n = 3 + Math.floor(r() * 3)
  let tallest = 0
  for (let i = 0; i < n; i++) {
    const rad = 0.42 + r() * 0.5
    const rock = ball(rad, r() < 0.68 ? P.basalt : P.basaltLit, 0)
    rock.scale.set(1 + r() * 0.5, 0.55 + r() * 0.55, 0.8 + r() * 0.45)
    rock.rotation.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6)
    const y = rad * (0.45 + r() * 0.25)
    rock.position.set((r() - 0.5) * 1.3, y, (r() - 0.5) * 1.1)
    g.add(rock)
    tallest = Math.max(tallest, y + rad * 0.5)
  }

  // Salt crust: thin caps on the upward faces only, never a rim all round —
  // salt collects where spray dries, which is the top and the seaward side.
  for (let i = 0; i < 3; i++) {
    const crust = ball(0.15 + r() * 0.12, P.saltCrust, 0)
    crust.scale.set(1.3, 0.16, 1.15)
    crust.position.set((r() - 0.5) * 1.0, tallest * (0.8 + r() * 0.3), (r() - 0.5) * 0.8)
    crust.castShadow = false
    g.add(crust)
  }

  // A tuft or two rooted in the cracks, so the rock belongs to the jungle.
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2
    sprig(g, leafMesh(0.4 + r() * 0.3, 0.14, 0.2, P.vineLeaf, 3), a, 0.7, 0.12 + r() * 0.2, 0.4)
  }

  return g
}

// --- canopy light shafts ------------------------------------------------------

/**
 * One shaft of dawn light coming through the canopy — an open cone, additive,
 * fog off, and deliberately almost invisible.
 *
 * Shafts are the single easiest effect to overdo. What sells them is that the
 * player never quite catches them being there: they belong to the gap, they
 * tell you the wall has a roof and a hole in it, and the moment they read as
 * "a cone mesh" the whole wall reads as geometry. Hence opacity in the
 * hundredths, no depth write, and warm ivory rather than anything approaching
 * lotto gold.
 *
 * The first pass ran at 0.10 over metre-and-a-half beams and produced exactly
 * that failure — three white wedges standing in the doorway with visible
 * straight edges, brighter than anything else in the frame. Additive blending
 * also *stacks*, so overlapping beams compound: the safe number is far lower
 * than it looks like it should be, and the beams have to be slim enough that
 * two rarely cross.
 *
 * Returns the mesh with `material` left transparent-additive; the caller owns
 * the tilt, the placement and the breathing.
 */
export function createLightShaft(topRadius: number, botRadius: number, height: number): THREE.Mesh {
  // Open-ended cylinder rather than a cone: a beam that widens as it falls has
  // a narrow mouth up at the canopy hole, not a point, and the caps would show
  // as two bright discs the moment the camera got under one.
  const geo = new THREE.CylinderGeometry(topRadius, botRadius, height, 7, 1, true)
  // Origin at the canopy end, so the caller hangs it from the hole it comes
  // through and lets it fall to the ground on its own length.
  geo.translate(0, -height / 2, 0)
  const material = new THREE.MeshBasicMaterial({
    color: 0xf0e6cd,
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 3
  return mesh
}
