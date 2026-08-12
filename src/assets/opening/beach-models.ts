import * as THREE from 'three'
import { mat, ball, cyl, block } from '../style'
import { LOTTO_GOLD } from '../../game/opening/types'
import type { TideDrop } from '../../game/opening/types'

/**
 * Procedural models for the opening beach — the crate, the pouch, the shovel,
 * the tide-line washups and the journal.
 *
 * The art thesis these serve: *nature is Maui, culture is Mediterranean*.
 * Everything here is a human artifact that washed in from somewhere else, so
 * every model leans on the culture palette — sun-bleached wood, flaking cobalt
 * paint, rough linen, olive wood and wrought iron, terracotta-adjacent warmth —
 * against the island's volcanic greens. Nothing in this file may use lotto
 * gold except the session-two impossible sea-glass, which is the point of it.
 *
 * All colours are authored slightly desaturated: the postfx grade multiplies
 * saturation by 1.2, so anything loud here turns lurid on screen.
 *
 * Style school: style.ts helpers only (mat/ball/cyl/block), Lambert flat-ish,
 * rounded silhouettes, no GLBs, no textures. Every factory returns a group
 * whose ground contact sits at local y = 0 so callers place with groundHeight.
 */

// --- palette (culture set, pre-desaturated for the grade) --------------------

/**
 * Sun-bleached crate planks — driftwood, but *warm* driftwood.
 *
 * The first pass authored these grey-cream and the crate photographed as a
 * stone box: on ivory sand under a warm dawn key, a plank lighter and cooler
 * than the ground it sits on has no value contrast to read a silhouette from,
 * and the eye files it as rock. These are pulled warmer and a step darker than
 * the sand so the crate sits *on* the beach instead of dissolving into it.
 */
const BLEACHED_WOOD = 0xd3bd92
/** Corner posts, battens and shadowed plank edges — the silhouette holders. */
const BLEACHED_WOOD_DARK = 0x9d8459
/** Grain slivers scored along the plank faces; barely darker, but it kills the
 *  "moulded plastic" read a flat rounded box has at ten steps. */
const WOOD_GRAIN = 0xb9a075
/** Flaking paint — the contract's culture blue, faded cobalt. */
const COBALT = 0x4a6fa5
/** Sun-cooked cobalt: the same coat, one more summer on. */
const COBALT_SUN = 0x6b87ae
/** Where the cobalt has weathered nearly away to a stain in the grain. */
const COBALT_FADED = 0x8b9bb0
/** Rope handles, drawstrings, coils — dry hemp. */
const ROPE = 0xb0996d
/** Pouch and journal-page linen (contract §5.1). */
const LINEN = 0xe8decc
/** Linen in shadow / the pouch's cinched neck. */
const LINEN_SHADE = 0xcfc3ac
/** The hand-stamped tomato mark — ink red, muted so it reads as a stamp. */
const STAMP_RED = 0xc05a48
const STAMP_GREEN = 0x6f9c58
/** Olive-wood shovel grip: pale yellowish wood with dark figure. */
const OLIVE_WOOD = 0xa8925e
const OLIVE_WOOD_DARK = 0x81704b
/** Wrought iron, near-black with a cold cast. */
const IRON = 0x50525a
const IRON_DARK = 0x3c3e44
/** Active rust blooming on the iron. */
const RUST = 0x9a5f3f
/** Washup materials. */
const SHELL_CREAM = 0xe6d9c4
const SHELL_BLUSH = 0xd9ad97
const SEA_GLASS_BLUE = 0x5f9eb0
const DRIFTWOOD = 0xb3a68e
const DRIFTWOOD_DARK = 0x8f846d
/** The odd fruit — dusky, wrong, deliberately NOT gold. */
const ODD_PLUM = 0x8b5c86
const ODD_SPECKLE = 0xd8cfc0
/** Journal cover — weathered leather over board. */
const JOURNAL_LEATHER = 0xa08663
const JOURNAL_PAGE = 0xf1ead8
const CHARCOAL = 0x2e2a26

// --- the crate ---------------------------------------------------------------

/** Seconds for the lid to swing fully open once creaked. */
const LID_OPEN_TIME = 0.55
/** Open lid angle — past vertical so the interior reads from the game camera. */
const LID_OPEN_ANGLE = -2.05

/**
 * The weathered crate the seeds arrive in — the first human artifact the
 * player touches. Sun-bleached planks, flaking cobalt paint, rope handles,
 * a hinged lid, and a shadowed interior deep enough to hide the pouch in.
 *
 * The lid is animated by the caller pumping `update(dt)` every frame (the
 * factory owns no clock); `openLid()` arms the swing with a slight ease-out
 * overshoot so the creak lands with a bit of weight.
 */
export function createOpeningCrate(): {
  root: THREE.Group
  openLid: () => void
  update: (dt: number) => void
} {
  const root = new THREE.Group()

  /*
   * Scale first, because scale was the bug.
   *
   * The crate is the second thing the player is asked to look at and it is
   * read from the wake camera, over the avatar's shoulder, at ten-ish steps.
   * At the old 1.15 × 0.8 × 0.64 it occupied a thumbnail's worth of screen and
   * whatever detail it carried was invisible; it read as "small grey thing".
   * A little over waist-high on the avatar and half again as wide is the size
   * at which a box says *crate* before any of its materials get a vote.
   */
  const W = 1.52
  const D = 1.04
  /** Wall height — three plank courses instead of two, so the sides stripe. */
  const H = 0.86
  /** Plank thickness; heavier boards, heavier crate. */
  const T = 0.085

  const floor = block(W - 0.1, 0.1, D - 0.1, BLEACHED_WOOD_DARK, 0.025)
  floor.position.y = 0.07
  root.add(floor)

  // The interior shadow — a dark false floor so the open crate reads deep.
  const hollow = block(W - 0.26, 0.03, D - 0.26, 0x2c2721, 0.01)
  hollow.position.y = 0.14
  root.add(hollow)

  /*
   * Walls as three courses of separate planks with a sliver of gap between
   * them, alternating light/dark. The gaps are the whole trick: a crate is
   * legible because it is *made of parts*, and one rounded box — however
   * nicely painted — is a suitcase.
   */
  const courses: { y: number; c: number }[] = [
    { y: 0.19, c: BLEACHED_WOOD },
    { y: 0.45, c: BLEACHED_WOOD_DARK },
    { y: 0.71, c: BLEACHED_WOOD },
  ]
  for (const side of [1, -1]) {
    for (const course of courses) {
      const plank = block(W, 0.23, T, course.c, 0.022)
      plank.position.set(0, course.y, side * (D / 2))
      root.add(plank)
    }
  }
  for (const side of [1, -1]) {
    for (const course of courses) {
      const plank = block(T, 0.23, D - 0.1, course.c === BLEACHED_WOOD ? BLEACHED_WOOD_DARK : BLEACHED_WOOD, 0.022)
      plank.position.set(side * (W / 2), course.y, 0)
      root.add(plank)
    }
  }

  // Corner posts hold the silhouette together at a glance.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const post = block(0.13, H + 0.04, 0.13, BLEACHED_WOOD_DARK, 0.025)
      post.position.set(sx * (W / 2 - 0.04), H / 2, sz * (D / 2 - 0.04))
      root.add(post)
    }
  }

  /*
   * Visible grain: thin darker slivers scored along the long faces. They cost
   * six meshes and they are the difference between "wooden" and "a smooth
   * pale surface that could be anything", which is exactly the read the first
   * pass got. Kept off the painted zones — paint would have filled them.
   */
  for (const side of [1, -1]) {
    for (const [i, y] of [0.14, 0.24, 0.5, 0.66, 0.76].entries()) {
      const grain = block(W * (0.5 + (i % 3) * 0.16), 0.014, 0.012, WOOD_GRAIN, 0.005)
      grain.position.set((i % 2 ? 0.18 : -0.22) * W * 0.4, y, side * (D / 2 + T / 2))
      root.add(grain)
    }
  }

  /**
   * Flaking cobalt paint.
   *
   * The first pass scattered six small chips and the crate photographed as a
   * grey box with blue dots on it — the reverse of the story. This crate was
   * *painted*, whole, by someone across the sea, and the beach has been taking
   * that paint off ever since. So the panels are large enough to be the
   * crate's colour (roughly half of every face), and it is the *wood* that
   * shows through, in torn patches, at the corners and along the bottom
   * course where the surf works hardest.
   *
   * Three blues do the weathering: cobalt where the coat is sound, sun-cooked
   * blue on the faces that take the light, and a faded stain where the pigment
   * has all but gone.
   */
  const paint: { x: number; y: number; z: number; ry: number; w: number; h: number; c: number }[] = [
    // Front face (+z): one big surviving panel, one sun-cooked strip, chips.
    { x: -0.18, y: 0.53, z: D / 2 + T / 2 + 0.012, ry: 0, w: 0.92, h: 0.42, c: COBALT },
    { x: 0.44, y: 0.46, z: D / 2 + T / 2 + 0.012, ry: 0, w: 0.36, h: 0.5, c: COBALT_SUN },
    { x: -0.34, y: 0.19, z: D / 2 + T / 2 + 0.012, ry: 0, w: 0.5, h: 0.16, c: COBALT_FADED },
    { x: 0.3, y: 0.16, z: D / 2 + T / 2 + 0.012, ry: 0, w: 0.17, h: 0.11, c: COBALT },
    // Back face (−z): the weather side, less paint left.
    { x: 0.1, y: 0.6, z: -(D / 2 + T / 2 + 0.012), ry: 0, w: 0.86, h: 0.3, c: COBALT_SUN },
    { x: -0.42, y: 0.42, z: -(D / 2 + T / 2 + 0.012), ry: 0, w: 0.44, h: 0.4, c: COBALT_FADED },
    { x: 0.5, y: 0.2, z: -(D / 2 + T / 2 + 0.012), ry: 0, w: 0.3, h: 0.15, c: COBALT },
    // Ends (±x).
    { x: W / 2 + T / 2 + 0.012, y: 0.55, z: 0.02, ry: Math.PI / 2, w: 0.66, h: 0.4, c: COBALT },
    { x: W / 2 + T / 2 + 0.012, y: 0.2, z: -0.26, ry: Math.PI / 2, w: 0.3, h: 0.16, c: COBALT_FADED },
    { x: -(W / 2 + T / 2 + 0.012), y: 0.48, z: -0.1, ry: Math.PI / 2, w: 0.58, h: 0.46, c: COBALT_SUN },
    { x: -(W / 2 + T / 2 + 0.012), y: 0.74, z: 0.24, ry: Math.PI / 2, w: 0.26, h: 0.14, c: COBALT },
  ]
  for (const f of paint) {
    const patch = block(f.w, f.h, 0.016, f.c, 0.02)
    patch.position.set(f.x, f.y, f.z)
    patch.rotation.y = f.ry
    patch.rotation.z = (f.w > 0.4 ? 0.012 : 0.06) * (f.y > 0.4 ? 1 : -1)
    root.add(patch)
  }

  // Rope handles: a thicker half-torus arcing off each end, plus the knot that
  // holds it — at this size the rope is a readable shape, not a wire.
  for (const side of [1, -1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.042, 6, 12, Math.PI), mat(ROPE))
    handle.castShadow = true
    handle.position.set(side * (W / 2 + 0.06), 0.5, 0)
    handle.rotation.set(0, Math.PI / 2, 0)
    root.add(handle)
    for (const sz of [1, -1]) {
      const knot = ball(0.055, ROPE, 0)
      knot.position.set(side * (W / 2 + 0.04), 0.5, sz * 0.16)
      root.add(knot)
    }
  }

  // Lid: four planks and two battens on a pivot group hinged at the back edge,
  // carrying its own surviving coat of paint so the open crate still reads blue.
  const lidPivot = new THREE.Group()
  lidPivot.position.set(0, H, -(D / 2) + 0.04)
  root.add(lidPivot)
  for (const [i, z] of [0.13, 0.39, 0.65, 0.91].entries()) {
    const plank = block(W + 0.08, 0.07, 0.25, i % 2 ? BLEACHED_WOOD_DARK : BLEACHED_WOOD, 0.022)
    plank.position.set(0, 0.035, z)
    lidPivot.add(plank)
  }
  for (const sx of [1, -1]) {
    const batten = block(0.13, 0.06, 0.96, BLEACHED_WOOD_DARK, 0.022)
    batten.position.set(sx * 0.5, 0.1, 0.52)
    lidPivot.add(batten)
  }
  for (const p of [
    { x: -0.22, z: 0.42, w: 0.8, d: 0.36, c: COBALT },
    { x: 0.44, z: 0.74, w: 0.42, d: 0.3, c: COBALT_SUN },
    { x: -0.5, z: 0.86, w: 0.3, d: 0.18, c: COBALT_FADED },
  ]) {
    const lidPaint = block(p.w, 0.016, p.d, p.c, 0.02)
    lidPaint.position.set(p.x, 0.078, p.z)
    lidPivot.add(lidPaint)
  }

  // --- lid animation ---------------------------------------------------------
  let opening = false
  let t = 0

  return {
    root,
    openLid: () => {
      opening = true
    },
    update: (dt: number) => {
      if (!opening || t >= 1) return
      t = Math.min(1, t + dt / LID_OPEN_TIME)
      // Ease-out with a small overshoot: the lid swings past open and settles.
      const k = t
      const overshoot = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)
      lidPivot.rotation.x = LID_OPEN_ANGLE * overshoot
    },
  }
}

// --- the seed pouch ----------------------------------------------------------

/**
 * The linen seed pouch — rough cloth, cinched drawstring, and the hand-stamped
 * tomato mark that tells the player what's inside without a word of text.
 * Lifted out of the crate by BeachProps, then handed to the DOM fly-to.
 */
export function createSeedPouch(): THREE.Group {
  const g = new THREE.Group()

  // Sagging linen body, wider than tall below the cinch.
  const body = ball(0.19, LINEN, 1)
  body.scale.set(1, 1.05, 0.85)
  body.position.y = 0.16
  g.add(body)

  // Cinched neck and the puff of gathered cloth above it.
  const neck = cyl(0.055, 0.08, 0.07, LINEN_SHADE, 8)
  neck.position.y = 0.31
  g.add(neck)
  const puff = ball(0.062, LINEN, 1)
  puff.scale.set(1, 0.75, 1)
  puff.position.y = 0.365
  g.add(puff)

  // Drawstring: a hemp loop at the cinch and two dangling knotted ends.
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 5, 10), mat(ROPE))
  loop.castShadow = true
  loop.position.y = 0.315
  loop.rotation.x = Math.PI / 2
  g.add(loop)
  for (const side of [1, -1]) {
    const end = cyl(0.008, 0.01, 0.09, ROPE, 5)
    end.position.set(side * 0.055, 0.27, 0.045)
    end.rotation.z = side * 0.5
    g.add(end)
    const knot = ball(0.016, ROPE, 0)
    knot.position.set(side * 0.075, 0.235, 0.055)
    g.add(knot)
  }

  /*
   * The stamp: a tomato in two inks pressed onto the front face. Meshes sit a
   * hair proud of the linen — at this scale a printed decal and a relief patch
   * read the same, and the relief needs no texture.
   */
  const stampFruit = ball(0.072, STAMP_RED, 1)
  stampFruit.scale.set(1, 0.9, 0.28)
  stampFruit.position.set(0, 0.15, 0.152)
  g.add(stampFruit)
  // Calyx: three short leaves, because a red disc alone reads as a dot.
  for (const a of [-0.7, 0, 0.7]) {
    const leaf = block(0.05, 0.016, 0.012, STAMP_GREEN, 0.006)
    leaf.position.set(Math.sin(a) * 0.03, 0.213 - Math.abs(a) * 0.012, 0.15)
    leaf.rotation.z = a * 0.9
    g.add(leaf)
  }
  const stampStalk = block(0.014, 0.03, 0.012, STAMP_GREEN, 0.005)
  stampStalk.position.set(0, 0.234, 0.15)
  g.add(stampStalk)

  return g
}

// --- the opening shovel ------------------------------------------------------

/**
 * The shovel that starts buried at 30° — the tool the whole opening pivots on.
 *
 * A restyle of `createShovelModel` (src/assets/character.ts:54): the same
 * silhouette and local layout (grip at +y, blade tip at −0.71) so the model
 * works both as the buried world prop and, later, in the avatar's hands —
 * but re-dressed Mediterranean: olive-wood grip with dark figure rings,
 * wrought-iron blade instead of bright steel, and active rust blooming
 * along the blade's edge.
 */
export function createOpeningShovel(): THREE.Group {
  const g = new THREE.Group()

  /*
   * Sized to be seen, not to be accurate.
   *
   * The first pass built this at a shade under a metre with a 24 mm shaft and
   * from the wake camera it was a dark stick in the sand — the player has no
   * reason to walk toward a twig. This one is ~1.3 units tip to grip with a
   * 45 mm shaft and a blade wide enough to catch the dawn key as a shape.
   * Local layout is preserved from the base model: grip at +y, tip at −y, so
   * the prop still buries by tilting and rising.
   */

  // Olive-wood shaft with darker figure rings — olive reads as streaked wood.
  const handle = cyl(0.042, 0.05, 0.86, OLIVE_WOOD, 7)
  handle.position.y = -0.12
  g.add(handle)
  for (const y of [0.06, -0.16, -0.38]) {
    const ring = cyl(0.047, 0.052, 0.05, OLIVE_WOOD_DARK, 7)
    ring.position.y = y
    g.add(ring)
  }

  // D-grip up top, same read as the base model: shovel, not spear.
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.026, 5, 10), mat(OLIVE_WOOD_DARK))
  grip.castShadow = true
  grip.position.y = 0.32
  grip.rotation.y = Math.PI / 2
  g.add(grip)
  // Cross-peg where the grip is pinned through the shaft.
  const peg = cyl(0.016, 0.016, 0.14, OLIVE_WOOD_DARK, 6)
  peg.position.y = 0.245
  peg.rotation.x = Math.PI / 2
  g.add(peg)

  /*
   * Wrought iron, not steel: a socket collar with two visible straps running
   * down onto the blade. The straps are the thing that reads "forged" from a
   * distance — a plain plate reads as a plastic paddle.
   */
  const collar = cyl(0.055, 0.068, 0.14, IRON_DARK, 7)
  collar.position.y = -0.6
  g.add(collar)
  const blade = block(0.3, 0.34, 0.045, IRON, 0.025)
  blade.position.y = -0.79
  g.add(blade)
  for (const sx of [1, -1]) {
    const strap = block(0.035, 0.2, 0.02, IRON_DARK, 0.008)
    strap.position.set(sx * 0.055, -0.7, 0.03)
    g.add(strap)
  }
  const point = new THREE.Mesh(new THREE.ConeGeometry(0.155, 0.19, 3), mat(IRON))
  point.castShadow = true
  point.rotation.x = Math.PI
  point.rotation.y = Math.PI / 2
  point.position.y = -1.0
  g.add(point)

  // Rust: broad blooms proud of the blade faces and a bad one eating the
  // collar. Active rust, per the manifest — this tool has been out here.
  const rustSpots: { x: number; y: number; z: number; w: number; h: number }[] = [
    { x: -0.07, y: -0.75, z: 0.026, w: 0.12, h: 0.16 },
    { x: 0.09, y: -0.89, z: 0.026, w: 0.09, h: 0.11 },
    { x: 0.03, y: -0.8, z: -0.026, w: 0.14, h: 0.1 },
    { x: -0.1, y: -0.94, z: -0.026, w: 0.07, h: 0.07 },
  ]
  for (const r of rustSpots) {
    const spot = block(r.w, r.h, 0.01, RUST, 0.008)
    spot.position.set(r.x, r.y, r.z)
    g.add(spot)
  }
  const collarRust = cyl(0.058, 0.071, 0.05, RUST, 7)
  collarRust.position.y = -0.55
  g.add(collarRust)

  return g
}

// --- tide-line washups -------------------------------------------------------

/**
 * Translucent flat-shaded lump for the sea-glass pieces. The one bespoke
 * material in this file: `mat()` has no opacity, and sea-glass without a
 * little light through it is just a painted rock.
 */
function glassLump(color: number, emissive: number, scale: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2 * scale, 0),
    new THREE.MeshLambertMaterial({
      color,
      emissive,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
    }),
  )
  m.castShadow = true
  m.scale.set(1.2, 0.55, 1)
  m.position.y = 0.1 * scale
  return m
}

/**
 * The washup glint.
 *
 * Manifest VFX 7 asks for a glint on the tide-line items, and the tideline's
 * bob idle can only do so much: on a broad ivory beach a small object with the
 * same value as the sand is invisible until you are standing on it. This is a
 * tiny near-white facet, faintly self-lit, angled up off the top of each
 * washup — it survives shadow, it moves with the bob, and it costs one mesh.
 *
 * Deliberately ivory, never gold: gold is luck, and finding a shell is not.
 */
function glint(r = 0.045): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(r, 0),
    mat(0xf4ecd8, { flat: true, emissive: 0x4a4234 }),
  )
  m.scale.set(1.3, 0.5, 0.9)
  return m
}

/**
 * One tide-line washup by id. Session-one set: spiral shell, blue sea-glass,
 * driftwood stick. Session-two set: rope coil, odd fruit, and the
 * impossible-colour sea-glass — the ONLY model here allowed LOTTO_GOLD,
 * because finding it *is* a lotto roll.
 */
export function createWashupProp(id: TideDrop['id']): THREE.Group {
  const g = new THREE.Group()

  switch (id) {
    case 'spiral-shell': {
      // Whorls: shrinking flat-shaded balls curling to a blushed tip.
      let r = 0.19
      let angle = 0
      let x = 0
      let z = 0
      for (let i = 0; i < 5; i++) {
        const whorl = ball(r, i >= 3 ? SHELL_BLUSH : SHELL_CREAM, i < 2 ? 1 : 0)
        whorl.scale.set(1.1, 0.75, 1)
        whorl.position.set(x, r * 0.7, z)
        g.add(whorl)
        angle += 1.9
        x += Math.cos(angle) * r * 0.85
        z += Math.sin(angle) * r * 0.85
        r *= 0.68
      }
      // The opening's lip, a flattened blush disc at the mouth of the shell.
      const lip = ball(0.11, SHELL_BLUSH, 1)
      lip.scale.set(1, 0.4, 0.8)
      lip.position.set(-0.14, 0.065, 0.07)
      lip.rotation.z = 0.5
      g.add(lip)
      const sheen = glint(0.05)
      sheen.position.set(0.02, 0.21, -0.02)
      sheen.rotation.z = 0.4
      g.add(sheen)
      break
    }

    case 'sea-glass': {
      g.add(glassLump(SEA_GLASS_BLUE, 0x0a1418, 1))
      const sheen = glint(0.042)
      sheen.position.set(0.02, 0.13, 0.02)
      sheen.rotation.y = 0.6
      g.add(sheen)
      break
    }

    case 'driftwood-stick': {
      // Two worn segments meeting at a knot — a bend reads as found wood.
      const a = cyl(0.048, 0.062, 0.64, DRIFTWOOD, 6)
      a.rotation.z = Math.PI / 2 - 0.12
      a.position.set(-0.14, 0.07, 0)
      g.add(a)
      const b = cyl(0.036, 0.046, 0.42, DRIFTWOOD, 6)
      b.rotation.set(0.3, 0, Math.PI / 2 - 0.55)
      b.position.set(0.31, 0.13, 0.06)
      g.add(b)
      const knot = ball(0.07, DRIFTWOOD_DARK, 0)
      knot.position.set(0.17, 0.08, 0.015)
      g.add(knot)
      // A split along the top where the sea has opened the grain.
      const split = block(0.34, 0.014, 0.016, DRIFTWOOD_DARK, 0.006)
      split.position.set(-0.16, 0.12, 0.012)
      split.rotation.z = 0.06
      g.add(split)
      const sheen = glint(0.038)
      sheen.position.set(-0.2, 0.125, -0.02)
      g.add(sheen)
      break
    }

    case 'rope-coil': {
      // Three slumped hemp loops and a loose end trailing off the coil.
      for (const [i, y] of [0.05, 0.13, 0.2].entries()) {
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.17 - i * 0.02, 0.048, 6, 12), mat(ROPE))
        loop.castShadow = true
        loop.receiveShadow = true
        loop.position.y = y
        loop.rotation.x = Math.PI / 2 + (i - 1) * 0.09
        loop.rotation.z = i * 0.7
        g.add(loop)
      }
      const end = cyl(0.038, 0.042, 0.24, ROPE, 6)
      end.position.set(0.24, 0.05, 0.08)
      end.rotation.set(0, 0.5, Math.PI / 2 - 0.25)
      g.add(end)
      break
    }

    case 'odd-fruit': {
      /*
       * The odd fruit is *wrong*, not lucky: dusky plum, pale speckles, a
       * kinked stalk. Deliberately nowhere near gold — the impossible glass
       * beside it owns the lotto read, and two golds would blur the grammar.
       */
      const body = ball(0.16, ODD_PLUM, 1)
      body.scale.set(1, 0.88, 1)
      body.position.y = 0.14
      g.add(body)
      const speckleAngles = [0.4, 1.6, 2.9, 4.1, 5.3]
      for (const [i, a] of speckleAngles.entries()) {
        const s = ball(0.02, ODD_SPECKLE, 0)
        s.position.set(Math.cos(a) * 0.14, 0.14 + Math.sin(a * 1.7 + i) * 0.07, Math.sin(a) * 0.14)
        g.add(s)
      }
      const stalk = cyl(0.014, 0.02, 0.09, 0x77804f, 5)
      stalk.position.set(0.02, 0.3, 0)
      stalk.rotation.z = -0.55
      g.add(stalk)
      break
    }

    case 'impossible-glass': {
      // Sea-glass in a colour the sea does not make. Small lotto, session two.
      g.add(glassLump(LOTTO_GOLD, 0x403208, 1.1))
      const shard = glassLump(LOTTO_GOLD, 0x403208, 0.45)
      shard.position.set(0.17, 0.035, 0.09)
      shard.rotation.y = 1.1
      g.add(shard)
      break
    }
  }

  return g
}

// --- the journal -------------------------------------------------------------

/**
 * The weathered logbook and charcoal stick for the sit-and-sketch beat.
 * A closed board-and-leather book with a hemp tie, pages proud of the cover,
 * charcoal lying beside it — the journal page itself is DOM (OpeningUi).
 */
export function createJournalProp(): THREE.Group {
  const g = new THREE.Group()

  const cover = block(0.4, 0.05, 0.3, JOURNAL_LEATHER, 0.02)
  cover.position.y = 0.025
  g.add(cover)
  const pages = block(0.365, 0.045, 0.27, JOURNAL_PAGE, 0.012)
  pages.position.set(0.012, 0.072, 0)
  g.add(pages)
  const backCover = block(0.4, 0.028, 0.3, JOURNAL_LEATHER, 0.012)
  backCover.position.y = 0.108
  g.add(backCover)
  // Spine wrap along the left edge holds the sandwich together visually.
  const spine = block(0.05, 0.13, 0.31, OLIVE_WOOD_DARK, 0.02)
  spine.position.set(-0.185, 0.065, 0)
  g.add(spine)
  // Hemp tie around the middle with a small knot.
  const tie = block(0.03, 0.135, 0.315, ROPE, 0.012)
  tie.position.set(0.08, 0.065, 0)
  g.add(tie)
  const tieKnot = ball(0.025, ROPE, 0)
  tieKnot.position.set(0.08, 0.135, 0.05)
  g.add(tieKnot)

  // The charcoal stick, dropped beside the book mid-use.
  const charcoal = cyl(0.013, 0.017, 0.15, CHARCOAL, 5)
  charcoal.position.set(0.28, 0.018, 0.12)
  charcoal.rotation.set(0, 0.6, Math.PI / 2 - 0.06)
  g.add(charcoal)

  return g
}
