import * as THREE from 'three'
import { ball, cyl } from '../style'

/**
 * The mystery sprout — what grows from the unmarked seed in the opening crate.
 *
 * Two states, per the Isle Opening spec (docs/ISLE-OPENING-SPEC.md §4.1):
 *
 *   'dormant'  — session one. The seed goes in like any other and then visibly
 *                does *nothing*: a dark, closed nub barely breaking the soil.
 *                No pulse, no glow, no promise. The absence is the content.
 *   'emerged'  — the first return. Taller than any crop around it,
 *                wrong-coloured, carrying one unopened bud, with a faint slow
 *                pulse of light inside the bud's seam. Tap says "You didn't
 *                plant this." Its bloom is future content — nothing here opens.
 *
 * Wrong-coloured is doing the identifying work. Every crop in the game wears
 * green foliage and the opening's whole world is warm; this plant is cool
 * blue-violet, so from any distance it reads as *not one of yours* before its
 * height does. Colours are authored a shade under-saturated because the postfx
 * grade multiplies saturation by 1.2, and violet is what that grade pushes
 * hardest.
 *
 * The pulse is warm ivory (PULSE_IVORY 0xefe3c8), deliberately NOT lotto gold:
 * gold means luck and nothing else (opening contract rule 4), and this moment
 * is mystery, not jackpot.
 *
 * Contract with Farm (game/farm.ts swaps this model in for the
 * 'mystery-sprout' crop id in place of createCropModel):
 *   - the group sits on the soil surface with its origin at y = 0;
 *   - `userData.fixedScale = true` — the sprout is authored at final size and
 *     opts out of the continuous growth scaling every other crop gets (its
 *     progress crawls at 1/9999 and would otherwise pin it at seedling scale);
 *   - `userData.baseScale` / `userData.stretch` are still recorded so any
 *     caller reasoning about crop extents finds the fields it expects;
 *   - `userData.update?: (elapsed: number) => void` drives the pulse; Farm
 *     calls it once per frame for planted crops that carry it.
 */

/*
 * Cool blue-violet, and off the palette on purpose.
 *
 * The opening's whole colour world is warm: ivory sand, caramel tide band, dawn
 * light, terracotta, deep jungle greens. Nothing in it leans cold, and nothing
 * in it leans blue-violet — which is why this plant does. It is not a "pretty
 * flower colour"; it is the one hue on screen that has no relatives, so the eye
 * lands on it before the brain has worked out what it is looking at.
 *
 * Authored a step under-saturated, as everything here is: the postfx grade
 * multiplies saturation by 1.2, and a violet is the colour that grade pushes
 * hardest.
 */
/** Stem: cold blue-violet, the spine of the wrongness. */
const C_STEM = 0x515a86
/** Leaf blades, a shade lighter and bluer than the stem. */
const C_LEAF = 0x64709c
/** Underside / inner blades, dropped toward slate so the tiers read apart. */
const C_LEAF_DIM = 0x474e73
/** The unopened bud's skin: pale periwinkle, the lightest value on the plant,
 *  which is what makes the bud the thing you look at. */
const C_BUD = 0xa294dd
/** Sepals wrapping the bud, darker so the closed seam reads. */
const C_SEPAL = 0x3f4468
/** The pulse inside the bud seam. Warm ivory — NEVER lotto gold. */
const C_PULSE = 0xefe3c8
/** The dormant nub — near-black soil-violet, deliberately unremarkable. */
const C_NUB = 0x413d5c

/**
 * Height of the emerged plant, soil to bud tip.
 *
 * Measured against the bed it stands in, not in the abstract: a ripe Sun Tomato
 * (assets/opening/sun-tomato.ts) reaches about 1.27 units and the odd one about
 * 1.45. This clears the tallest of them by half again, so on the first return
 * the player reads "something is wrong in the garden" from the doorstep, before
 * they are close enough for the colour to register.
 */
const EMERGED_HEIGHT = 2.05
/** The dormant nub's height. Barely there, on purpose. */
const DORMANT_HEIGHT = 0.24

/** Seconds per full pulse breath. Slow — a heartbeat, not a beacon. */
const PULSE_PERIOD = 2.8
/** Pulse opacity range. Faint: the player should notice it at dusk and doubt
 *  it at noon, which is exactly the register the spec asks for. */
const PULSE_MIN = 0.08
const PULSE_MAX = 0.34

/**
 * A narrow drooping leaf blade built from a squashed sphere.
 *
 * Local to this file rather than borrowing the crop pipeline's leaf pad: that
 * geometry is internal to assets/crops.ts, and this plant *should not* share
 * the crops' leaf silhouette anyway — its blades are longer, thinner and hang
 * rather than cup, which is one more cue that it is not from the same stock.
 */
function blade(len: number, color: number, tilt: number, spin: number) {
  const leaf = ball(0.5, color, 1)
  // Wider than the first pass. At 0.22 the blades were threads: from the game
  // camera the plant read as a bare pole with a bead on it, which is a
  // rendering artefact, not a stranger in the garden.
  leaf.scale.set(len * 0.34, len * 0.08, len)
  const g = new THREE.Group()
  // Origin at the stem end so the tilt pivots at the attachment point.
  leaf.position.z = len * 0.42
  g.add(leaf)
  g.rotation.order = 'YXZ'
  g.rotation.set(-tilt, spin, 0)
  return g
}

export function createMysterySprout(state: 'dormant' | 'emerged'): THREE.Group {
  const group = new THREE.Group()

  if (state === 'dormant') {
    /*
     * A dark closed nub and two folded seed-leaves. It has to read as "planted,
     * alive, doing nothing" rather than as a bug — so it gets a recognisable
     * sprout silhouette, just drained of colour and refusing to grow.
     */
    const nub = cyl(0.045, 0.075, DORMANT_HEIGHT, C_NUB, 6)
    nub.position.y = DORMANT_HEIGHT / 2
    group.add(nub)

    const tip = ball(0.07, C_STEM, 1)
    tip.scale.set(1, 1.5, 1)
    group.add(tip)
    tip.position.y = DORMANT_HEIGHT

    for (let i = 0; i < 2; i++) {
      const leaf = blade(0.2, C_LEAF_DIM, 0.9, i * Math.PI + 0.4)
      leaf.position.y = DORMANT_HEIGHT * 0.8
      group.add(leaf)
    }
  } else {
    // --- emerged: the stranger standing in the player's garden --------------

    /*
     * A stalk with real thickness.
     *
     * The first pass drew this at a 0.035 radius over a metre and a half, which
     * from the game camera is a wire — the plant read as a floating bud with no
     * body, and half the time as a rendering artefact. It is the tallest thing
     * in the garden; it has to have a trunk you could grip.
     */
    const stemH = EMERGED_HEIGHT * 0.74
    const stem = cyl(0.05, 0.095, stemH, C_STEM, 8)
    stem.position.y = stemH / 2
    group.add(stem)

    // A kink partway up, so the silhouette is a grown thing rather than a
    // flagpole — the one concession to organic shape the plant makes.
    const upper = cyl(0.038, 0.052, EMERGED_HEIGHT * 0.24, C_STEM, 8)
    upper.position.set(0.05, stemH + EMERGED_HEIGHT * 0.1, 0)
    upper.rotation.z = -0.14
    group.add(upper)

    /*
     * Two tiers of long hanging blades, and nothing between them.
     *
     * Sparse is the point: every crop in the garden is a dense little dome, and
     * this is an open, drooping, top-heavy thing with bare stalk showing. The
     * bare stretch is what makes the height legible at a glance — a plant
     * clothed to the ground reads as short and wide however tall it is.
     */
    for (let i = 0; i < 6; i++) {
      const leaf = blade(0.62, i % 2 ? C_LEAF : C_LEAF_DIM, -0.95, (i / 6) * Math.PI * 2 + 0.3)
      leaf.position.y = stemH * 0.28
      group.add(leaf)
    }
    for (let i = 0; i < 5; i++) {
      const leaf = blade(0.5, i % 2 ? C_LEAF_DIM : C_LEAF, -0.8, (i / 5) * Math.PI * 2 + 0.9)
      leaf.position.y = stemH * 0.55
      group.add(leaf)
    }
    for (let i = 0; i < 3; i++) {
      const leaf = blade(0.4, i % 2 ? C_LEAF : C_LEAF_DIM, -0.62, (i / 3) * Math.PI * 2 + 1.6)
      leaf.position.y = stemH * 0.82
      group.add(leaf)
    }

    // --- the unopened bud ---------------------------------------------------
    const budY = EMERGED_HEIGHT - 0.22
    const budRoot = new THREE.Group()
    budRoot.position.set(0.08, budY, 0)
    group.add(budRoot)

    // The bud body: an ovoid tapering upward, closed. No petals, no opening —
    // the reveal is future content and nothing about this shape offers one.
    // Sized to be the plant's headline. A bud that reads as a bud from the
    // game camera needs to be roughly a fruit across, not a bead — the whole
    // silhouette is "bare stalk carrying one closed thing", and the one closed
    // thing has to carry it.
    const bud = ball(0.17, C_BUD, 1)
    bud.scale.set(1, 1.6, 1)
    bud.position.y = 0.12
    budRoot.add(bud)

    // Sepals wrapped over the lower half, meeting at the seam. Their tips
    // stopping short of the crown is what draws the eye to the closed top.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      const sepal = ball(0.115, C_SEPAL, 1)
      sepal.scale.set(0.55, 1.5, 0.55)
      sepal.position.set(Math.cos(a) * 0.095, 0.04, Math.sin(a) * 0.095)
      sepal.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22)
      budRoot.add(sepal)
    }

    /*
     * The pulse: one small additive glow inside the bud, breathing.
     *
     * Its material is built here rather than through the shared `mat` cache
     * because the animation writes opacity every frame — a cached material
     * would throb on every object that happened to share the colour.
     */
    const glowMat = new THREE.MeshBasicMaterial({
      color: C_PULSE,
      transparent: true,
      opacity: PULSE_MIN,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 2), glowMat)
    glow.position.y = 0.22
    budRoot.add(glow)

    group.userData.update = (elapsed: number) => {
      // Eased sine breath: dwell at dim, swell briefly — a slow exhale of
      // light rather than a blink.
      const t = (Math.sin((elapsed / PULSE_PERIOD) * Math.PI * 2) + 1) / 2
      const breath = t * t
      glowMat.opacity = PULSE_MIN + (PULSE_MAX - PULSE_MIN) * breath
      const s = 1 + breath * 0.18
      glow.scale.setScalar(s)
    }
  }

  /*
   * The fields Farm's scaling path expects on every crop model. fixedScale is
   * the one that matters: it tells applyCropScale to leave this plant alone,
   * because its progress (1/9999 per second) would otherwise hold it at
   * seedling size forever — and the whole point is that it towers.
   */
  group.userData.fixedScale = true
  group.userData.baseScale = group.scale.clone()
  group.userData.stretch = state === 'emerged' ? EMERGED_HEIGHT : DORMANT_HEIGHT

  return group
}
