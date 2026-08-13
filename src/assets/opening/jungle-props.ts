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

const tmpTone = new THREE.Color()
const tmpNext = new THREE.Color()

/**
 * Pick a canopy tone for a lobe sitting at height ratio `t` (0 = ground, 1 =
 * crown top), knocked up or down by `vary` ∈ [-1, 1] so no two neighbouring
 * lobes land on exactly the same value.
 *
 * Doing this by height rather than at random is what gives a single crown its
 * own light: the shaded belly reads as depth behind the lit cap, and at wall
 * density those bellies join up into the dark mass the whole design rests on.
 *
 * **`vary` used to be a ramp *index* offset, and that is what made the wall
 * read as "a flat curtain of dark green polygon blobs."** Six discrete stops,
 * two of them the same green, meant a whole rank of lobes drew from a palette
 * of four values — so at wall density, adjacent metre-wide facets kept coming
 * up identical and merged into one continuous slab of colour with polygon
 * creases across it. The eye had nothing to separate one crown from the next.
 *
 * Sampling the ramp *continuously* and then applying a small multiplicative
 * value nudge fixes it at the root: every lobe on the wall now has its own
 * value, so a crown reads as a cluster of forms rather than as one shape with
 * lines on it. The nudge is quantised to a dozen steps only to keep `mat()`'s
 * material cache from growing a key per lobe.
 */
function canopyTone(t: number, vary: number): number {
  const c = Math.min(1, Math.max(0, t)) * (CANOPY_RAMP.length - 1)
  const i = Math.min(CANOPY_RAMP.length - 2, Math.floor(c))
  tmpTone.setHex(CANOPY_RAMP[i])
  tmpNext.setHex(CANOPY_RAMP[i + 1])
  tmpTone.lerp(tmpNext, c - i)
  // Linear-space exposure nudge: three converted on setHex and converts back
  // on getHex, so this is a value change and not a hue shift.
  tmpTone.multiplyScalar(1 + Math.round(Math.min(1, Math.max(-1, vary)) * 6) / 26)
  return tmpTone.getHex()
}

/**
 * A foliage lobe: a squashed low-poly sphere, turned to a random attitude.
 *
 * The rotation is not decoration. `ball(detail 0)` is an icosahedron, and an
 * icosahedron placed at the same attitude every time presents the *same* twenty
 * facets to the camera — so a rank of them shows one repeated polygon pattern
 * across the whole wall, which is the other half of why the mass read as flat.
 * Tumbling each one scatters the facet angles, and flat shading then does the
 * work of breaking the silhouette up for free.
 */
function lobe(radius: number, color: number, r: () => number, flatten = 0.52): THREE.Mesh {
  const m = ball(radius, color, 0)
  m.scale.set(1.3, flatten, 1.3)
  m.rotation.set(r() * Math.PI, r() * Math.PI, r() * Math.PI)
  m.castShadow = false
  return m
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
  /*
   * Fourteen small lobes rather than nine big ones.
   *
   * At emergent scale a 1.6-unit lobe is nearly four metres across on screen,
   * and four metres of one flat colour is a *slab*, not foliage — which is
   * literally what the review saw. Halving the radius and raising the count
   * keeps the same mass while cutting the size of the largest uninterrupted
   * facet by two thirds, and gives the value jitter above enough separate
   * pieces to work with.
   */
  const crownBase = trunkH - 0.9
  const lobes = 14
  for (let i = 0; i < lobes; i++) {
    const t = i / (lobes - 1)
    const y = crownBase + t * 3.6
    const spread = 1.7 * Math.sin(Math.PI * (0.22 + t * 0.72))
    const a = i * 2.399 + r() * 0.7
    const rad = 0.72 + r() * 0.42 - t * 0.14
    const piece = lobe(rad, canopyTone(0.24 + t * 0.76, r() * 2 - 1), r)
    piece.position.set(Math.cos(a) * spread, y, Math.sin(a) * spread)
    g.add(piece)
  }

  // The outline: leaves fanning out of the crown, drooping harder the further
  // out they reach. Top ones catch the dawn — the spec's warm rim light.
  //
  // Narrow rather than broad. A wide flat card of one flat colour reads as a
  // shard of coloured glass the moment it turns face-on to the camera, and a
  // wall of them looks shattered; long and slim reads as a leaf from any angle
  // and edge-on simply disappears into the mass, which is what it should do.
  //
  // Count raised with the lobe count: the leaves are the *ragged* part of the
  // silhouette, and a crown of small bumps with a thin fringe still reads as
  // broccoli. This is the rank the skyline is made of, so it earns the verts.
  for (let i = 0; i < 30; i++) {
    const t = r()
    const a = i * 2.399 + r() * 0.5
    const y = crownBase + 0.2 + t * 3.6
    const tone = t > 0.78 ? P.broadleafLit : canopyTone(0.3 + t * 0.68, r() - 0.5)
    const leaf = leafMesh(1.6 + r() * 1.3, 0.4 + r() * 0.24, 0.62 + r() * 0.5, tone, 4)
    leaf.castShadow = false
    sprig(g, leaf, a, -0.05 - r() * 0.6 + t * 0.4, y, 0.55 + r() * 0.8)
  }

  // Understory: the daylight-killer. Nothing gets between these and the ground.
  for (let i = 0; i < 8; i++) {
    const a = i * 1.9 + r()
    const y = 0.7 + r() * 2.3
    const piece = lobe(0.62 + r() * 0.46, canopyTone(0.04 + r() * 0.26, r() * 2 - 1), r, 0.6)
    piece.position.set(Math.cos(a) * (0.7 + r() * 1.2), y, Math.sin(a) * (0.7 + r() * 1.2))
    g.add(piece)
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

    for (let i = 0; i < 6; i++) {
      const t = i / 5
      const piece = lobe(0.62 + r() * 0.38, canopyTone(0.25 + t * 0.72, r() * 2 - 1), r, 0.55)
      piece.position.set(cx + (r() - 0.5) * 1.5, crownY + t * 1.6, cz + (r() - 0.5) * 1.5)
      g.add(piece)
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
  for (let i = 0; i < 9; i++) {
    const a = i * 1.7 + r()
    const piece = lobe(0.58 + r() * 0.4, canopyTone(r() * 0.3, r() * 2 - 1), r, 0.58)
    piece.position.set(Math.cos(a) * (0.9 + r() * 1.3), 0.6 + r() * 1.7, Math.sin(a) * (0.9 + r() * 1.3))
    g.add(piece)
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
  for (let i = 0; i < 13; i++) {
    const t = i / 12
    const piece = lobe(0.68 + r() * 0.4, canopyTone(0.4 + t * 0.6, r() * 2 - 1), r, 0.5)
    piece.position.set(
      tipX * (0.5 + t * 0.6) + (r() - 0.5) * 1.1,
      tipY + 0.3 + (r() - 0.5) * 0.9,
      (r() - 0.5) * 2.8,
    )
    g.add(piece)
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

// --- the verticals ------------------------------------------------------------

/**
 * A bare jungle trunk, ~8.5 units — the wall's punctuation.
 *
 * The review of the last pass called the wall "a flat curtain of dark green
 * polygon blobs", and the diagnosis is in the noun: *blobs*. Every module in
 * this file is a rounded mass, so at wall density the whole thing is one field
 * of overlapping lumps with nothing in it for the eye to measure. Real jungle
 * reads deep because it is full of hard verticals — columns of dark, sharply
 * lit down one side, standing in front of the mush and cutting it into panels.
 *
 * So this is a trunk and almost nothing else: no crown to speak of, buttress
 * roots, two dead stubs, and a liana wrapped up it. It is placed *in front of*
 * the standing ranks rather than among them, because a trunk with foliage
 * between it and the camera is not punctuation, it is more mush.
 *
 * Deliberately the darkest wood in the file — a backlit trunk at dawn is a
 * silhouette, and silhouettes are what give a mass its depth.
 */
export function createJungleTrunk(variant: number): THREE.Group {
  const r = rng(11300 + variant * 233)
  const g = new THREE.Group()

  const h = 7.6 + r() * 2.2
  const lean = (r() - 0.5) * 0.13
  // Two stacked sections with a step in radius, so the trunk tapers visibly
  // instead of reading as a lamp post.
  const lower = cyl(0.3, 0.46, h * 0.55, P.trunkDark, 7)
  lower.position.set(0, h * 0.275, 0)
  lower.rotation.z = lean
  g.add(lower)
  const upper = cyl(0.19, 0.3, h * 0.5, P.trunkDark, 6)
  upper.position.set(Math.sin(lean) * h * 0.5, h * 0.55 + h * 0.25, 0)
  upper.rotation.z = lean * 1.5
  g.add(upper)

  // Buttress roots: the Maui banyan tell, and the reason the trunk meets the
  // ground in a flare rather than in a seam.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r() * 0.7
    const root = cyl(0.07, 0.34, 1.5 + r() * 0.6, P.trunkDark, 5)
    root.position.set(Math.cos(a) * 0.42, 0.66, Math.sin(a) * 0.42)
    root.rotation.set(Math.sin(a) * 0.42, 0, -Math.cos(a) * 0.42)
    g.add(root)
  }

  // Dead stubs. Two of them, high, short — the thing that says "this trunk had
  // branches once" without adding a second silhouette to argue with.
  for (let i = 0; i < 2; i++) {
    const a = r() * Math.PI * 2
    const stub = cyl(0.05, 0.12, 0.7 + r() * 0.6, P.trunk, 5)
    stub.position.set(Math.cos(a) * 0.35, h * (0.58 + i * 0.16), Math.sin(a) * 0.35)
    stub.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1)
    g.add(stub)
  }

  // A liana up the shaft, with a few leaves on it. One diagonal across a
  // vertical is all it takes to stop the column reading as a pipe.
  const wrapA = r() * Math.PI * 2
  for (let i = 0; i < 7; i++) {
    const t = i / 7
    const a = wrapA + t * 4.2
    const seg = cyl(0.035, 0.05, h * 0.13, P.vineLeaf, 4)
    seg.position.set(Math.cos(a) * 0.34, 0.5 + t * h * 0.75, Math.sin(a) * 0.34)
    seg.rotation.set(0.3, -a, 0.5)
    seg.castShadow = false
    g.add(seg)
    if (i % 2 === 0) {
      const leaf = leafMesh(0.42 + r() * 0.3, 0.2 + r() * 0.1, 0.12, P.vineLeaf, 3)
      leaf.castShadow = false
      sprig(g, leaf, a, -0.9 - r() * 0.4, 0.5 + t * h * 0.75, 0.4)
    }
  }

  // A thin crown, high and small: enough that the trunk is not sawn off at the
  // top, not enough to add another lump to the canopy it stands in front of.
  for (let i = 0; i < 3; i++) {
    const a = i * 2.399 + r()
    const piece = lobe(0.55 + r() * 0.35, canopyTone(0.75 + r() * 0.25, r() * 2 - 1), r, 0.45)
    piece.position.set(
      Math.sin(lean) * h + Math.cos(a) * (0.5 + r() * 0.7),
      h - 0.2 + r() * 0.7,
      Math.sin(a) * (0.5 + r() * 0.7),
    )
    g.add(piece)
  }
  for (let i = 0; i < 6; i++) {
    const a = i * 2.399 + r() * 0.6
    const leaf = leafMesh(1.5 + r() * 0.8, 0.44 + r() * 0.2, 0.7, P.broadleafLit, 4)
    leaf.castShadow = false
    sprig(g, leaf, a, -0.1 - r() * 0.4, h - 0.1 + r() * 0.8, Math.sin(lean) * h + 0.5)
  }

  return g
}

// --- the front edge -----------------------------------------------------------

/**
 * A lobed monstera/banana leaf, built as three blades off one stem.
 *
 * `leafMesh` makes a single tapered blade, which is a *frond*. What the front
 * of a jungle wall needs is the other thing — a leaf the size of a person, with
 * the split, lobed outline that reads as "tropical" from across the beach. Cut
 * the blade into three and fan them a few degrees apart and the silhouette gets
 * its notches for free, at three triangles' cost.
 */
function lobedLeaf(len: number, wid: number, droop: number, color: number): THREE.Group {
  const g = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const spread = (i - 1) * 0.26
    const blade = leafMesh(len * (i === 1 ? 1 : 0.86), wid * 0.46, droop, color, 4)
    blade.rotation.order = 'YXZ'
    blade.rotation.y = spread
    blade.rotation.z = -Math.abs(spread) * 0.5
    blade.castShadow = false
    g.add(blade)
  }
  return g
}

/**
 * Monstera stand, ~2.9 units and nearly as wide — the front edge's scale rule.
 *
 * The wall has no object in it whose size a player can guess at: lobes and
 * fronds are abstractions and could be any size, so the whole treeline floats
 * free of the beach it stands on. A person-sized leaf fixes that in one prop.
 * These sit at the very front, spilling into the clearing, and they are
 * authored *dark* — they are read as shapes against the lit wall behind them,
 * not as another lit surface.
 *
 * Sparse by design. Two per bend, not a hedge of them: the moment they repeat,
 * they stop being scale and start being wallpaper.
 */
export function createMonsteraStand(variant: number): THREE.Group {
  const r = rng(12700 + variant * 251)
  const g = new THREE.Group()

  const n = 4 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.8
    // Long petioles arching out of one crown — the plant's whole gesture.
    const rise = 1.1 + r() * 1.0
    const out = 0.35 + r() * 0.4
    const stem = cyl(0.045, 0.075, rise * 1.25, P.vineLeaf, 5)
    stem.position.set((Math.cos(a) * out) / 2, rise * 0.6, (Math.sin(a) * out) / 2)
    stem.rotation.set(Math.sin(a) * 0.34, 0, -Math.cos(a) * 0.34)
    stem.castShadow = false
    g.add(stem)

    const len = 1.5 + r() * 0.95
    const leaf = lobedLeaf(
      len,
      len * (0.72 + r() * 0.2),
      len * 0.42,
      r() < 0.3 ? P.broadleaf : r() < 0.7 ? P.canopyMid : P.canopyDeep,
    )
    leaf.position.set(Math.cos(a) * out, rise, Math.sin(a) * out)
    leaf.rotation.order = 'YXZ'
    leaf.rotation.y = -a
    leaf.rotation.x = -0.18 - r() * 0.4
    g.add(leaf)
  }

  // Two half-unfurled spears, straight up — the vertical accent that stops the
  // stand reading as a splat of leaves on the ground.
  for (let i = 0; i < 2; i++) {
    const spear = cyl(0.05, 0.1, 1.5 + r() * 0.9, P.broadleaf, 5)
    spear.position.set((r() - 0.5) * 0.4, 0.85 + r() * 0.4, (r() - 0.5) * 0.4)
    spear.rotation.z = (r() - 0.5) * 0.3
    spear.castShadow = false
    g.add(spear)
  }

  const core = ball(0.36, P.canopyShade, 0)
  core.scale.set(1.3, 0.7, 1.3)
  core.position.y = 0.22
  core.castShadow = false
  g.add(core)
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

  for (let i = 0; i < 10; i++) {
    const a = i * 2.399 + r() * 0.8
    const piece = lobe(0.6 + r() * 0.5, canopyTone(r() * 0.2, r() * 1.4 - 0.9), r, 0.62)
    piece.position.set(
      Math.cos(a) * (0.35 + r() * 1.2),
      0.42 + r() * 1.5,
      Math.sin(a) * (0.35 + r() * 1.2),
    )
    g.add(piece)
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
 * One shaft of dawn light coming through the canopy — three crossed cards with
 * the beam painted into their vertex colours, additive, fog off, and with no
 * silhouette of its own.
 *
 * **This module has failed twice, both times the same way**, and the reason is
 * worth writing down because the obvious construction is the wrong one.
 *
 * A shaft built as an open cone or cylinder — however low its opacity — is a
 * *solid* with a hard rim. Every pixel inside the rim gets the same additive
 * lift and every pixel outside it gets none, so the mesh announces its own
 * edges: three grey plastic tubes standing in the doorway. Worse, the lift is
 * constant along its whole length, so the beam ends in a straight line across
 * the ground. And worst of all, a solid has an inside: fly the camera into one
 * and its far wall becomes a full-screen veil, which is exactly the enormous
 * translucent wedge that ruined beats 6 and 8. Lowering the opacity does not
 * fix any of those three things — it only makes a badly-shaped effect fainter.
 *
 * What a shaft actually is, is a *gradient*: brightest at the hole it comes
 * through, dying out as it falls and as it spreads, with no edge anywhere. So:
 *
 *  - **Cards, not a solid.** Three quads crossed about the beam axis. A card
 *    has no interior, so there is no camera position that fills the screen —
 *    a camera passing through one crosses a plane whose alpha there is already
 *    near zero.
 *  - **The falloff is in the vertex colours.** Additive blending multiplies by
 *    the vertex colour, and additive black is a no-op, so a colour ramp *is* an
 *    alpha ramp with no extra state: full at the canopy mouth, zero at the two
 *    long edges, zero at the bottom. Nothing on this mesh has a visible border.
 *  - **The visible beam is only its top half.** The vertical falloff is a
 *    cubic, so the lower part of the card carries almost nothing. The beam
 *    hangs in the canopy and dissolves before it reaches head height — which is
 *    both what dawn light through leaves looks like and what keeps the effect
 *    out of the gameplay camera's way.
 *
 * `topRadius`/`botRadius` are half-widths in world units: this thing should be
 * a hand's width at the top and under a metre at the bottom, never "a few
 * units". Warm ivory only — nothing here goes near lotto gold.
 *
 * Returns the mesh with `material` left transparent-additive; the caller owns
 * the tilt, the placement and the breathing.
 */
export function createLightShaft(topRadius: number, botRadius: number, height: number): THREE.Mesh {
  /** Crossed cards. Three is enough that one is always near-facing. */
  const PLANES = 3
  /** Columns of vertices across a card: the outer two carry zero brightness. */
  const COLS = 6
  /** Rows down a card, enough to resolve the falloff without banding. */
  const ROWS = 8

  const base = new THREE.Color(0xf3ead2)
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []

  for (let p = 0; p < PLANES; p++) {
    // Planes, not half-planes — a card already spans both sides of the axis, so
    // the set only has to sweep 180°.
    const a = (p / PLANES) * Math.PI
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const first = pos.length / 3

    for (let j = 0; j <= ROWS; j++) {
      const t = j / ROWS
      // Cubic decay down the beam, with the mouth itself pulled back a little
      // so the very top edge is not a bright line where the card is cut off.
      const fall = (1 - t) * (1 - t) * (1 - t)
      const mouth = Math.min(1, t / 0.09)
      const vFade = fall * mouth
      const half = topRadius + (botRadius - topRadius) * t
      const y = -t * height
      for (let i = 0; i <= COLS; i++) {
        const u = (i / COLS) * 2 - 1
        // Smooth across the width, zero at both long edges: the card has no
        // side you can see, only a core that gets brighter toward the middle.
        const hFade = Math.cos((u * Math.PI) / 2) ** 1.5
        const k = vFade * hFade
        pos.push(ca * u * half, y, sa * u * half)
        col.push(base.r * k, base.g * k, base.b * k)
      }
    }

    const stride = COLS + 1
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const v0 = first + j * stride + i
        idx.push(v0, v0 + stride, v0 + 1, v0 + 1, v0 + stride, v0 + stride + 1)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    // The gradient carries the shape; this is only the master dimmer, and the
    // three cards cross, so the core sees roughly three times this number.
    opacity: 0.055,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // A card is one triangle thick, so a pixel is covered once whichever face
    // wins — double-siding costs nothing and stops the beam popping out of
    // existence as the camera swings past its plane.
    side: THREE.DoubleSide,
    fog: false,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = 3
  return mesh
}
