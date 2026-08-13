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
 * Sun-bleached crate planks — driftwood.
 *
 * Three passes bracket this value. Authored grey-cream, the crate read as a
 * stone box — lighter and cooler than the ground it stands on, it had no
 * silhouette. Authored warm tan, it read as a *new* box from a farm game.
 * Authored a desaturated putty (`0xc2b498`) it photographed, under the dawn
 * key, as **grey**: a taupe machine crate with markings stencilled on it, which
 * is the exact read the whole art thesis exists to avoid.
 *
 * The lesson is that grey is not a colour driftwood can afford to be *authored*
 * as, because the shaded half of every plank supplies all the grey the eye
 * needs. So this is the spec's own weathered-wood value: warm at full light,
 * grey where the light leaves it.
 */
const BLEACHED_WOOD = 0xc9b79a
/**
 * Corner posts, battens and shadowed plank edges — the silhouette holders.
 * Warm brown rather than the old warm-grey: two greys stacked is a stone,
 * two woods stacked is a plank and the seam between them.
 */
const BLEACHED_WOOD_DARK = 0xa08a68
/** Grain slivers scored along the plank faces; barely darker, but it kills the
 *  "moulded plastic" read a flat rounded box has at ten steps. */
const WOOD_GRAIN = 0xb5a082
/** The shadow line in a plank gap — a crate is legible because you can see
 *  daylight (or the lack of it) between its boards. */
const PLANK_GAP = 0x4a3d2e
/** The pale, dried-out edge where paint has flaked away and left raw wood
 *  bleaching in the sun. Painted around each surviving patch of cobalt, it is
 *  what turns a blue rectangle into a blue rectangle that is *coming off*. */
const FLAKE_EDGE = 0xdcd0b6
/** Flaking paint — the contract's culture blue, faded cobalt. */
const COBALT = 0x4a6fa5
/** Sun-cooked cobalt: the same coat, one more summer on. */
const COBALT_SUN = 0x6b87ae
/** Where the cobalt has weathered nearly away to a stain in the grain. */
const COBALT_FADED = 0x8b9bb0
/**
 * Rope handles, drawstrings, coils — dry hemp.
 *
 * Pulled down in both value and saturation from `0xb0996d`. Hemp sits at ~39°
 * hue, which is lotto gold's own neighbourhood, and under the dawn key a fat
 * bright loop of it photographed as a **gold horseshoe hung on the crate** —
 * the reserved colour, on the environment, in the first minute. Value and
 * saturation are what separate rope from luck: gold is bright and saturated,
 * so hemp is neither.
 */
const ROPE = 0x9d8a6b
/** Knots and the shadow side of a coil: hemp that has been wet a lot. */
const ROPE_DARK = 0x7c6a4f
/** Pouch and journal-page linen (contract §5.1). */
const LINEN = 0xe8decc
/** Linen in shadow / the pouch's cinched neck. */
const LINEN_SHADE = 0xcfc3ac
/** The hand-stamped tomato mark — ink red, muted so it reads as a stamp. */
const STAMP_RED = 0xc05a48
const STAMP_GREEN = 0x6f9c58
/**
 * Olive-wood shovel grip: pale wood with dark figure, pushed a step green and
 * a step down in saturation from `0xa8925e`. Olive is a *greenish* tan, and
 * the yellower value was reading — like the old rope — as one more warm gold
 * object under a warm key.
 */
const OLIVE_WOOD = 0xa09364
const OLIVE_WOOD_DARK = 0x7a6d48
/** Wrought iron, near-black with a cold cast. */
const IRON = 0x50525a
const IRON_DARK = 0x3c3e44
/**
 * The blade's worn edge: iron polished bright by the ground it cuts. It is the
 * one light value on the whole tool, and it is what makes a dark blade read as
 * a *blade* rather than as a shadow — spec beat 3 asks for exactly this ("the
 * blade catches dawn light"). Cool steel, never warm: warm-and-bright at this
 * size is the reserved colour's job.
 */
const IRON_EDGE = 0xc3c8cf
/** Active rust blooming on the iron. */
const RUST = 0x9a5f3f
const RUST_DEEP = 0x7a4229
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

/**
 * Deterministic value noise, 0..1 — the pattern the crate's paint has broken
 * into.
 *
 * Scattering paint with a plain per-cell random gives a *checkerboard*, which
 * is what the previous pass photographed as: blue confetti stencilled on a
 * grey box. Paint does not come off one square at a time; it comes off in
 * connected areas, because a flake takes its neighbours with it. Smoothly
 * interpolated lattice noise is the cheapest thing that produces connected
 * areas with ragged borders, and being a pure function of the cell index it
 * costs no rng state and looks the same on every boot.
 */
function paintNoise(x: number, y: number, seed: number): number {
  const hash = (ix: number, iy: number) => {
    const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453
    return s - Math.floor(s)
  }
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/**
 * A length of hemp rope as *rope*, not as a drawn arc.
 *
 * The first pass hung a `TorusGeometry` off the crate's end, and from the wake
 * camera it photographed as a smooth bright semicircle painted onto the wood —
 * a smile. What makes rope read as rope at ten steps is not its curve, it is
 * the **lay**: the regular light/dark banding of the twist running along it.
 * So the loop is built from short tangent segments in alternating hemp tones,
 * each nudged off the centreline, which gives the banding for the price of a
 * dozen tiny cylinders and survives being small on screen.
 *
 * Built in the local XY plane (centre at the origin, arc opening downward),
 * so callers orient the whole group exactly as they would have oriented a
 * torus.
 */
function ropeArc(radius: number, thickness: number, arc: number, segments: number): THREE.Group {
  const g = new THREE.Group()
  const step = arc / segments
  const start = -arc / 2 - Math.PI / 2
  for (let i = 0; i < segments; i++) {
    const a = start + (i + 0.5) * step
    // The loop is slack: it hangs a little wider at the bottom than a circle.
    const droop = 1 + 0.12 * Math.max(0, -Math.sin(a))
    const strand = cyl(thickness, thickness, radius * step * 1.55, i % 2 ? ROPE_DARK : ROPE, 5)
    strand.position.set(Math.cos(a) * radius * droop, Math.sin(a) * radius * droop, (i % 2 ? 1 : -1) * thickness * 0.3)
    // A cylinder's axis is +y; rotating it by `a` about z lands it on the
    // tangent (−sin a, cos a), which is the direction the rope runs.
    strand.rotation.z = a
    strand.rotation.x = (i % 2 ? 1 : -1) * 0.22
    g.add(strand)
  }
  return g
}

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
   * Walls as three courses of separate planks, alternating light/dark, sitting
   * a few millimetres proud of a dark carcass box.
   *
   * The carcass is the fix for the previous pass. Planks butted straight
   * against each other differ only in tone, and two tones of the same wood
   * flatten into one slab from ten steps — a suitcase. A dark box *behind* the
   * courses turns every gap between them into a visible shadow line, and those
   * lines are what say "made of boards" before any material gets a vote.
   */
  const carcass = block(W - 0.02, H, D - 0.02, PLANK_GAP, 0.02)
  carcass.position.y = H / 2
  root.add(carcass)

  const courses: { y: number; c: number }[] = [
    { y: 0.155, c: BLEACHED_WOOD },
    { y: 0.44, c: BLEACHED_WOOD_DARK },
    { y: 0.725, c: BLEACHED_WOOD },
  ]
  for (const side of [1, -1]) {
    for (const course of courses) {
      const plank = block(W, 0.245, T, course.c, 0.022)
      plank.position.set(0, course.y, side * (D / 2))
      root.add(plank)
    }
  }
  for (const side of [1, -1]) {
    for (const course of courses) {
      const plank = block(T, 0.245, D - 0.1, course.c === BLEACHED_WOOD ? BLEACHED_WOOD_DARK : BLEACHED_WOOD, 0.022)
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
   * Iron corner banding, rusting.
   *
   * Manifest item: "iron corner banding with rust". It does two jobs beyond
   * the obvious one. It is the only *cold* value on a warm object, which is
   * what stops the crate reading as one lump of tan; and a band wrapping a
   * corner is a shape you only ever see on a shipping box, so it says CRATE
   * from further away than any amount of paint does.
   */
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      for (const [k, y] of [0.16, H - 0.13].entries()) {
        const alongX = block(0.3, 0.08, 0.022, k ? IRON : IRON_DARK, 0.006)
        alongX.position.set(sx * (W / 2 - 0.14), y, sz * (D / 2 + T / 2 + 0.008))
        root.add(alongX)
        const alongZ = block(0.022, 0.08, 0.26, k ? IRON : IRON_DARK, 0.006)
        alongZ.position.set(sx * (W / 2 + T / 2 + 0.008), y, sz * (D / 2 - 0.13))
        root.add(alongZ)
        // Rust bleeding down off the band onto the wood below it.
        if ((sx + sz + k) % 2 === 0) {
          const bleed = block(0.11, 0.09, 0.012, k ? RUST : RUST_DEEP, 0.006)
          bleed.position.set(sx * (W / 2 - 0.2), y - 0.08, sz * (D / 2 + T / 2 + 0.012))
          bleed.rotation.z = sx * 0.1
          root.add(bleed)
        }
      }
    }
  }

  /*
   * Visible grain: thin darker slivers scored along the long faces. They cost
   * six meshes and they are the difference between "wooden" and "a smooth
   * pale surface that could be anything", which is exactly the read the first
   * pass got.
   */
  for (const side of [1, -1]) {
    for (const [i, y] of [0.12, 0.2, 0.47, 0.69, 0.78].entries()) {
      const grain = block(W * (0.4 + (i % 3) * 0.14), 0.014, 0.012, WOOD_GRAIN, 0.005)
      grain.position.set((i % 2 ? 0.18 : -0.22) * W * 0.4, y, side * (D / 2 + T / 2))
      root.add(grain)
    }
  }

  /**
   * Flaking cobalt paint — broken *areas*, covering about half the box.
   *
   * Four failed passes bracket this. Six scattered chips gave a grey box with
   * blue dots. Big clean rectangles covering half of every face gave a
   * *painted* box, solid and manufactured, which is the farm-game read the art
   * thesis exists to avoid. A single band around the middle photographed as
   * **stripes**, two flat blue bars on a grey machine crate. Dealing that band
   * over a coarse 6 × 3 grid was the fourth: at a quarter of a metre a tile is
   * a *plank* of paint, three rows of them fill the wall top to bottom, and
   * the review read the result as what it was — blue trim round a wooden box.
   *
   * The lesson is that the grid has to be finer than the thing it is breaking
   * up. Paint fails at a scale of a few centimetres; tiles at a fifth of that
   * again (eight or nine across a face, five up it) let `paintNoise` draw
   * connected blobs two or three tiles wide with genuinely ragged borders,
   * which is the read the spec asks for and no arrangement of quarter-metre
   * rectangles can give.
   *
   * Three further rules put the breaks where a weathered crate actually breaks
   * rather than wherever the noise happened to dip:
   *  - **Hostility.** The corners, the seams between plank courses, the top the
   *    weather stands on and the bottom the sand scours all demand a higher
   *    noise value before the coat survives there.
   *  - **Wear ramp.** Cobalt only deep inside a surviving area; sun-cooked blue
   *    towards its rim; a faded stain where the pigment has nearly gone.
   *  - **Failure from inside out.** A tile with paint on all four sides is not
   *    safe: a second, finer noise punches bare sun-bleached wood through the
   *    middle of it. Tiles on a border get the pale bite taken out of that
   *    border instead.
   */
  const faces: {
    ry: number
    span: number
    /** Face-local (u along the face, y up, lift off the surface) → local xyz. */
    at: (u: number, y: number, lift: number) => [number, number, number]
  }[] = [
    { ry: 0, span: W, at: (u, y, lift) => [u, y, D / 2 + T / 2 + lift] },
    { ry: Math.PI, span: W, at: (u, y, lift) => [-u, y, -(D / 2 + T / 2 + lift)] },
    { ry: Math.PI / 2, span: D, at: (u, y, lift) => [W / 2 + T / 2 + lift, y, -u] },
    { ry: -Math.PI / 2, span: D, at: (u, y, lift) => [-(W / 2 + T / 2 + lift), y, u] },
  ]
  /**
   * Fraction of each face the coat still covers.
   *
   * Taken as a *quantile* of the noise rather than as a fixed threshold on it.
   * A fixed threshold makes coverage a lottery — the four faces came out at
   * 15%, 50%, 48% and 36%, so the face the wake camera happens to look at was
   * either nearly bare or nearly painted depending on which seed offset it drew.
   * Ranking the cells and keeping the top half means every face gets the
   * half-painted read the spec asks for, and the noise still decides *which*
   * half.
   */
  const PAINT_COVER = 0.55
  /** How far hostility can push a cell down that ranking. */
  const CHIP_BIAS = 0.14
  const ROWS = 5
  for (const [fi, face] of faces.entries()) {
    const cols = Math.max(5, Math.round(face.span / 0.19))
    const cellW = face.span / cols
    const cellH = (H - 0.1) / ROWS
    /** The coat, at roughly three tiles per noise cell so areas stay connected. */
    const coat = (i: number, j: number) => paintNoise(i * 0.3 + fi * 5.3, j * 0.38 + fi * 2.1, fi + 1)
    /** Where a surviving area has worn through to the wood anyway — finer, so
     *  it punches holes rather than shaving whole blobs off. */
    const bare = (i: number, j: number) => paintNoise(i * 0.95 + fi * 3.7, j * 1.13 + fi * 8.3, fi + 11)
    /**
     * How hostile a cell is to paint, 0..1.
     *
     * Rows 1 and 3 of five land on the gaps between the three plank courses —
     * the seams a coat splits along first — and rows 0 and 4 are the sand line
     * and the weather line. Columns at either end of a face are the box's
     * corners, which is where a crate loses paint before anywhere else.
     */
    const hostility = (i: number, j: number) => {
      const corner = i === 0 || i === cols - 1 ? 1 : i === 1 || i === cols - 2 ? 0.4 : 0
      const seam = j === 1 || j === 3 ? 0.75 : 0
      const weather = j === 0 ? 0.9 : j === ROWS - 1 ? 0.5 : 0
      return Math.max(corner, Math.max(seam, weather))
    }
    const scores: number[] = []
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < ROWS; j++) scores.push(coat(i, j) - CHIP_BIAS * hostility(i, j))
    }
    const ranked = scores.slice().sort((a, b) => a - b)
    const cut = ranked[Math.floor(ranked.length * (1 - PAINT_COVER))]
    const scoreAt = (i: number, j: number) =>
      i < 0 || j < 0 || i >= cols || j >= ROWS ? -1 : scores[i * ROWS + j]
    const painted = (i: number, j: number) => scoreAt(i, j) >= cut
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < ROWS; j++) {
        if (!painted(i, j)) continue

        const openTop = !painted(i, j + 1)
        const openBottom = !painted(i, j - 1)
        const openLeft = !painted(i - 1, j)
        const openRight = !painted(i + 1, j)
        const open = (openTop ? 1 : 0) + (openBottom ? 1 : 0) + (openLeft ? 1 : 0) + (openRight ? 1 : 0)

        /**
         * Which of the three blues a tile takes — decided by *topology*, not by
         * its own noise value.
         *
         * Per-tile tone was the mistake that survived the move to a fine grid.
         * Ranking each tile independently means neighbours inside one patch
         * come out as different blues, which shatters the patch into
         * confetti — the frames came back reading as digital camouflage, which
         * is not much better than the stripes it replaced. Paint does not fade
         * cell by cell; a coat fades from its *edges* in. So a tile with paint
         * all round it is cobalt, a tile on the rim is sun-cooked, and a nub
         * hanging on by one or two sides is the faded stain. The patches then
         * read as areas with worn borders, which is the thing being drawn.
         *
         * Counted over all eight neighbours rather than the four the bites use.
         * On a grid this fine, four-way "fully enclosed" is a rare cell, so the
         * pale COBALT_FADED took two thirds of the coat and the crate came back
         * grey-blue — the very read the culture colour exists to avoid.
         */
        let buried = 0
        for (let di = -1; di <= 1; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if ((di || dj) && painted(i + di, j + dj)) buried++
          }
        }
        const colour = buried >= 6 ? COBALT : buried >= 4 ? COBALT_SUN : COBALT_FADED
        /*
         * Tiles overlap and wander a little off their cell. The overlap fuses
         * neighbours in one area into a single shape; the wander is what stops
         * the shape's border being a staircase of identical squares.
         */
        const jx = (((i * 13 + j * 7) % 7) - 3) / 3
        const jy = (((i * 5 + j * 11) % 7) - 3) / 3
        const u = (i + 0.5) * cellW - face.span / 2 + jx * cellW * 0.12
        const y = 0.08 + (j + 0.5) * cellH + jy * cellH * 0.12
        const tile = block(cellW * (1.16 + jy * 0.1), cellH * (1.14 + jx * 0.1), 0.016, colour, 0.014)
        const [px, py, pz] = face.at(u, y, 0.012)
        tile.position.set(px, py, pz)
        tile.rotation.y = face.ry
        tile.rotation.z = (((i * 7 + j * 3) % 5) - 2) * 0.024
        root.add(tile)

        /*
         * Bare wood through the middle of the coat.
         *
         * This is the part the "blue trim" read was missing. A coat that only
         * ever fails at its edges keeps a solid painted interior, and a solid
         * painted interior of any shape reads as a panel someone painted on
         * purpose. Real paint on real wood also lets go from the inside — a
         * flake lifts in the middle of a good patch and takes a coin of
         * bleached grain with it — so a tile well inside an area gets a wood
         * chip laid a hair proud of it wherever the finer noise says so.
         */
        if (open <= 1 && bare(i, j) > 0.62) {
          const hole = block(cellW * (0.4 + (i % 3) * 0.14), cellH * 0.46, 0.02, BLEACHED_WOOD, 0.01)
          const [hx, hy, hz] = face.at(
            u + cellW * (i % 2 ? 0.16 : -0.18),
            y + cellH * (j % 2 ? 0.1 : -0.12),
            0.02,
          )
          hole.position.set(hx, hy, hz)
          hole.rotation.y = face.ry
          hole.rotation.z = i % 3 ? 0.22 : -0.28
          root.add(hole)
        }
        if (open === 0) continue

        /*
         * Flaking, done as bites out of the coat rather than a frame around
         * it. A pale plate behind the whole patch — the obvious way to draw
         * "worn edge" — photographs as a paper label stuck to the crate. What
         * reads as flaking is the paint's EDGE being eaten into: a short
         * sliver of bare wood pushed in over the tile's rim, a hair proud of
         * the paint so it wins the depth test. Vertical bites as well as
         * horizontal ones, or every break on the box runs the same way and the
         * courses turn back into stripes.
         *
         * Two things keep them from photographing as white confetti stuck to
         * the box, which is how the first fine-grid pass came back. Most of
         * them are BLEACHED_WOOD, the plank tone itself, so a bite that
         * overhangs onto bare wood disappears into it and only the part lying
         * across the paint reads; FLAKE_EDGE — the dried-out rim, the lightest
         * value on the crate — is reserved for one in three. And the offsets
         * are inside the tile's own rim rather than past it, so a bite eats the
         * coat instead of sitting beside it.
         */
        // Not every rim tile gets one: a bite on all of them draws a dotted
        // pale outline round each patch, which is a *frame* again.
        if ((i * 5 + j * 3) % 2 !== 0) continue
        const sideways = (openLeft || openRight) && (i * 3 + j) % 3 === 0
        const biteTone = (i + j) % 3 === 0 ? FLAKE_EDGE : BLEACHED_WOOD
        let bite: THREE.Mesh
        let bu: number
        let bv: number
        if (sideways) {
          const left = openLeft && (!openRight || j % 2 === 0)
          bite = block(cellW * 0.28, cellH * (0.44 + (j % 2) * 0.22), 0.02, biteTone, 0.01)
          bu = u + (left ? -1 : 1) * cellW * 0.38
          bv = y + cellH * (j % 2 ? 0.12 : -0.1)
        } else {
          const top = openTop && (!openBottom || (i + j) % 2 === 0)
          bite = block(cellW * (0.38 + (i % 2) * 0.2), cellH * 0.3, 0.02, biteTone, 0.01)
          bu = u + cellW * (i % 3 ? 0.14 : -0.16)
          bv = y + (top ? 1 : -1) * cellH * 0.38
        }
        const [bx, by, bz] = face.at(bu, bv, 0.02)
        bite.position.set(bx, by, bz)
        bite.rotation.y = face.ry
        bite.rotation.z = (i % 2 ? 0.15 : -0.11) + (j % 2 ? 0.06 : -0.05)
        root.add(bite)
      }
    }
  }

  /*
   * Rope handles — real rope, not a painted arc.
   *
   * Two failed passes. A thin half-torus standing off the end photographed as
   * a grey semicircle *drawn on* the crate; a fat one in bright hemp
   * photographed as a gold smile, which is worse, because gold is spoken for.
   * Rope reads as rope when it (a) shows the light/dark banding of its twist,
   * (b) hangs — a slack loop, not a rigid arch — and (c) is visibly tied to
   * something. So: a segmented, slack, two-tone loop through two lashing
   * knots, with a short tail from each knot lying against the wood.
   */
  for (const side of [1, -1]) {
    const handle = ropeArc(0.155, 0.027, Math.PI * 0.95, 11)
    handle.position.set(side * (W / 2 + 0.06), 0.47, 0)
    // Rolled so the loop's mouth faces the crate and its belly hangs down and
    // out, rather than standing up like a handle moulded into a suitcase.
    handle.rotation.set(0, Math.PI / 2, Math.PI * 0.06)
    root.add(handle)

    for (const sz of [1, -1]) {
      // The lashing knot where the rope passes through the plank.
      const knot = ball(0.05, ROPE_DARK, 0)
      knot.scale.set(1, 0.9, 1.15)
      knot.position.set(side * (W / 2 + 0.03), 0.48, sz * 0.15)
      root.add(knot)

      // A short frayed tail hanging off each knot.
      const tail = cyl(0.016, 0.023, 0.13, ROPE_DARK, 5)
      tail.position.set(side * (W / 2 + 0.035), 0.41, sz * 0.17)
      tail.rotation.set(0.2 * sz, 0, side * 0.22)
      root.add(tail)
    }
  }

  /*
   * Lid: planks over a dark under-slab, on a pivot group hinged at the back
   * edge, with iron hinge straps and its own surviving coat of paint.
   *
   * The under-slab and the overhanging lip are what make it read as a *lid*
   * rather than as the top of the box: a lid is a separate object resting on a
   * rim, and the shadow it throws into its own overhang is the only thing that
   * says so while the crate is still shut.
   */
  const lidPivot = new THREE.Group()
  lidPivot.position.set(0, H, -(D / 2) + 0.04)
  root.add(lidPivot)
  const lidUnder = block(W + 0.04, 0.05, D - 0.02, PLANK_GAP, 0.015)
  lidUnder.position.set(0, 0.0, 0.52)
  lidPivot.add(lidUnder)
  for (const [i, z] of [0.14, 0.4, 0.66, 0.92].entries()) {
    const plank = block(W + 0.1, 0.07, 0.24, i % 2 ? BLEACHED_WOOD_DARK : BLEACHED_WOOD, 0.022)
    plank.position.set(0, 0.045, z)
    lidPivot.add(plank)
  }
  for (const sx of [1, -1]) {
    const batten = block(0.13, 0.06, 0.96, BLEACHED_WOOD_DARK, 0.022)
    batten.position.set(sx * 0.5, 0.105, 0.52)
    lidPivot.add(batten)
  }
  // Hinge straps: iron, at the pivot, so the lid is visibly *hung* on the back.
  for (const sx of [1, -1]) {
    const strap = block(0.09, 0.03, 0.3, IRON_DARK, 0.008)
    strap.position.set(sx * 0.34, 0.085, 0.14)
    lidPivot.add(strap)
    const pin = cyl(0.028, 0.028, 0.13, IRON, 6)
    pin.position.set(sx * 0.34, 0.055, 0.01)
    pin.rotation.z = Math.PI / 2
    lidPivot.add(pin)
  }
  /*
   * The lid's coat: the same dealt paint as the walls, one summer further on.
   *
   * Weather works hardest on the surface it can stand on. The lid takes the
   * rain, the salt spray and the sun square instead of edge-on, so the bar the
   * coat has to clear is higher here and the ramp is shifted — most of what
   * survives is sun-cooked or faded, and true cobalt only holds in the deepest
   * pockets. Four hand-placed rectangles (what this replaces) read as a
   * painted panel with a few chips knocked out of it; a thin dealt coat reads
   * as a lid that *used to be* blue, which is the difference the whole thesis
   * turns on.
   */
  /** Fraction of the lid still blue — a third, against the walls' half. */
  const LID_COVER = 0.34
  const LID_COLS = 9
  const LID_ROWS = 5
  const lidSpanX = W + 0.1
  const lidCellW = lidSpanX / LID_COLS
  /** Plank run on the lid: four 0.24-deep boards from z = 0.02 to z = 1.04. */
  const lidCellD = 1.02 / LID_ROWS
  const lidX = (i: number) => -lidSpanX / 2 + (i + 0.5) * lidCellW
  /** True where a column lands on one of the two battens, which stand proud. */
  const onBatten = (i: number) => Math.abs(Math.abs(lidX(i)) - 0.5) < 0.075
  const lidScores: number[] = []
  for (let i = 0; i < LID_COLS; i++) {
    for (let j = 0; j < LID_ROWS; j++) {
      // The lid's rim is where hands, rain and the lifting go; the coat gives
      // way there first whatever the noise says.
      const rim = i === 0 || i === LID_COLS - 1 || j === LID_ROWS - 1 || j === 0 ? 0.16 : 0
      lidScores.push(paintNoise(i * 0.38 + 11.2, j * 0.47 + 4.4, 7) - rim)
    }
  }
  const lidRanked = lidScores.slice().sort((a, b) => a - b)
  const lidCut = lidRanked[Math.floor(lidRanked.length * (1 - LID_COVER))]
  const lidPainted = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < LID_COLS && j < LID_ROWS && lidScores[i * LID_ROWS + j] >= lidCut
  for (let i = 0; i < LID_COLS; i++) {
    for (let j = 0; j < LID_ROWS; j++) {
      if (!lidPainted(i, j)) continue
      const open =
        (lidPainted(i, j + 1) ? 0 : 1) +
        (lidPainted(i, j - 1) ? 0 : 1) +
        (lidPainted(i - 1, j) ? 0 : 1) +
        (lidPainted(i + 1, j) ? 0 : 1)
      // Topology decides the tone here too (see the walls), shifted one stop
      // worn: on the surface the weather stands on, even a patch's middle has
      // been cooked, and only what is buried two deep is still true cobalt.
      const colour = open >= 2 ? COBALT_FADED : open === 1 ? COBALT_SUN : COBALT
      const x = lidX(i)
      const z = 0.02 + (j + 0.5) * lidCellD
      // A batten stands 0.03 above the planks and is 0.13 wide, so its share of
      // the coat is a narrower sliver laid on top of it rather than inside it.
      const batten = onBatten(i)
      const tile = block(
        batten ? 0.115 : lidCellW * 1.1,
        0.016,
        lidCellD * (batten ? 0.92 : 1.08),
        colour,
        0.014,
      )
      tile.position.set(batten ? Math.sign(x) * 0.5 : x, batten ? 0.142 : 0.088, z)
      tile.rotation.y = batten ? 0 : (((i * 5 + j) % 5) - 2) * 0.02
      lidPivot.add(tile)
      // Bare wood through the coat, on the same inside-out rule as the walls.
      if (batten || paintNoise(i * 1.07 + 3.1, j * 1.21 + 9.6, 13) < 0.5) continue
      const chip = block(lidCellW * 0.44, 0.018, lidCellD * 0.4, BLEACHED_WOOD, 0.01)
      chip.position.set(x + lidCellW * (i % 2 ? 0.18 : -0.2), 0.092, z + lidCellD * (j % 2 ? 0.16 : -0.18))
      chip.rotation.y = i % 3 ? 0.24 : -0.3
      lidPivot.add(chip)
    }
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
  // The worn edge: a thin bright band across the blade's cutting end, the one
  // light value on the tool. Without it the blade reads as a shadow at ten
  // steps, which is exactly the distance beat 3 asks the player to cross.
  const edge = block(0.28, 0.03, 0.05, IRON_EDGE, 0.006)
  edge.position.y = -0.945
  g.add(edge)

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
