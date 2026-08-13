import * as THREE from 'three'
import { mat, ball, cyl, block } from '../style'
import { loadModels, peekModels, type LoadedModel, type ModelCache } from '../models'
import { LOTTO_GOLD } from '../../game/opening/types'
import type { TideDrop } from '../../game/opening/types'

/**
 * Models for the opening beach — the crate, the pouch, the shovel, the
 * tide-line washups and the journal.
 *
 * Mixed provenance, as of the authored-asset pass. The crate (body and lid),
 * the seed pouch, and the three session-one washups are glTF models loaded
 * through the shared cache in assets/models.ts; the shovel, the journal and
 * the session-two washups are still built in code here. The two schools are
 * kept apart on purpose — an authored prop wears its own texture and is only
 * sized, tilted and grounded by this file, and nothing here reaches into an
 * authored material to repaint it. The single exception is documented where it
 * happens: the impossible sea-glass borrows the ordinary shard's geometry and
 * supplies its own material, because the reserved gold has to arrive pure.
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
 * Style school for what remains procedural: style.ts helpers only
 * (mat/ball/cyl/block), Lambert flat-ish, rounded silhouettes. Authored or not,
 * every factory returns a group whose ground contact sits at local y = 0, so
 * callers place with groundHeight and nothing floats or sinks.
 */

// --- palette (culture set, pre-desaturated for the grade) --------------------

/*
 * The crate is an authored model now — body and lid, both textured with their
 * own flaking cobalt over weathered plank. The long list of hand-mixed wood and
 * paint values that used to live here went with it; what remains below is the
 * palette of the props that are still built in code.
 */
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
/** The hand-stamped tomato mark — ink red, muted so it reads as a stamp. */
const STAMP_RED = 0xc05a48
const STAMP_GREEN = 0x6f9c58
/**
 * Longest axis of the seed pouch, in world units.
 *
 * Sized against the crate it comes out of rather than against the player: it
 * has to be a thing that was plausibly inside, and it has to clear the rim on
 * the way up without filling the shot.
 */
const POUCH_SIZE = 0.42
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
/*
 * The session-one washups — spiral shell, sea glass, driftwood stick — are
 * authored models now, so their palette lives in their own textures rather
 * than here. What is left of the washup set below is procedural.
 */
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
 * Overall width of the crate, in world units, and the height it stands to.
 *
 * Both are held from the procedural crate this replaced, because both are load
 * bearing outside this file: beach-props.ts sinks the root a hand's width into
 * the sand, banks drift mounds against known corners, and registers a
 * one-metre collider around it. A crate that changed size would leave the sand
 * banked against nothing and the player walking through a corner.
 *
 * The authored body arrives normalised into a unit box that is markedly
 * flatter than the crate it replaces (1 : 0.33 : 0.61 against 1 : 0.57 : 0.68),
 * so height is set separately rather than falling out of the width. That is a
 * ~1.35x vertical stretch, which on mottled plank texture at the wake camera's
 * distance is invisible, and the alternative — scaling uniformly to the right
 * height — gives a crate 2.3 units wide: wider than the avatar is tall, and
 * wider than its own collider.
 */
const CRATE_W = 1.62
const CRATE_H = 0.74
/** How far in front of the rear rim the hinge sits. */
const HINGE_INSET = 0.06

/**
 * The weathered crate the seeds arrive in — the first human artifact the
 * player touches.
 *
 * Two authored models, assembled here: an open-topped body and a separate lid.
 * They have to be two files because beat 2 is *the lid opening*, and one fused
 * mesh could not do it.
 *
 * The lid hangs off a hinge group parked on the body's rear rim rather than
 * being rotated on its own origin — the mesh is centred on itself, so rotating
 * it directly would spin the lid about its middle like a propeller instead of
 * swinging it off the back. Same contract as before for the caller: the
 * factory owns no clock, `openLid()` arms the swing, and `update(dt)` pumps it
 * with a small ease-out overshoot so the creak lands with some weight.
 */
export function createOpeningCrate(): {
  root: THREE.Group
  openLid: () => void
  update: (dt: number) => void
} {
  const root = new THREE.Group()
  // Built up front, empty, so `openLid`/`update` are valid from the first frame
  // whether or not the glTF has landed yet.
  const lidPivot = new THREE.Group()
  root.add(lidPivot)

  const attach = (models: ModelCache) => {
    const body = models.openingCrate
    const bb = body.geometry.boundingBox!
    const bSize = bb.getSize(new THREE.Vector3())
    const sx = CRATE_W / bSize.x
    const sy = CRATE_H / bSize.y
    const shell = new THREE.Mesh(body.geometry, body.material)
    shell.castShadow = true
    // The interior is the inside of this same mesh, and the pouch is revealed
    // out of it — so it has to take light and take shadow like everything else.
    shell.receiveShadow = true
    shell.scale.set(sx, sy, sx)
    // Underside at local y = 0: beach-props sinks the root from there.
    shell.position.y = -bb.min.y * sy
    root.add(shell)

    const depth = bSize.z * sx

    /*
     * The lid is scaled uniformly off the shared width, not stretched with the
     * body. It is a thin panel — nobody reads its thickness — and letting it
     * keep its own proportions is what stops it looking like a different
     * object bolted on. Its authored depth is ~11% greater than the body's,
     * which lands as a lip overhanging the rim front and back: exactly what a
     * crate lid does, and free.
     */
    const lid = models.openingCrateLid
    const lb = lid.geometry.boundingBox!
    const ls = CRATE_W / (lb.max.x - lb.min.x)
    const panel = new THREE.Mesh(lid.geometry, lid.material)
    panel.castShadow = true
    panel.receiveShadow = true
    panel.scale.setScalar(ls)
    panel.position.set(0, -lb.min.y * ls, depth / 2 - HINGE_INSET)
    lidPivot.position.set(0, CRATE_H, -depth / 2 + HINGE_INSET)
    lidPivot.add(panel)
  }

  const ready = peekModels()
  if (ready) attach(ready)
  else void loadModels().then(attach).catch((e) => console.warn('opening crate never loaded', e))

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
 * The seed pouch — the one prop in this file that is also a *beat*.
 *
 * At beat 2 it lifts out of the crate, spins once, and hands its world position
 * to the DOM fly-to that gives birth to the satchel slot (BeachProps drives the
 * rise; OpeningUi.bornSatchel takes it from there). Two things follow from that
 * and both are load-bearing:
 *
 *  - **The origin is the pouch's base, not its middle.** BeachProps parks it at
 *    a height inside the crate, raises that height by POUCH_RISE_HEIGHT, and
 *    spins it on `rotation.y`. A model centred on its own middle would sit half
 *    through the crate floor and wobble about its waist on the way up. So the
 *    authored mesh is lifted by its own bounding box, exactly like the washups.
 *  - **The tomato stamp is not decoration.** The spec's whole reason for a
 *    stamped mark is that it says "tomato seeds" with no text, at the one moment
 *    the game has no UI to say it with.
 *
 * The authored model supplies the sack; the stamp is still built here, in the
 * mesh's own local space so it rides the model's resting tilt. It has to be:
 * the authored baseColour is a mottled brown-olive sacking with no mark of any
 * kind on it (and no red anywhere in the atlas), so swapping the model in
 * wholesale would have quietly deleted the beat's only piece of information.
 */
export function createSeedPouch(): THREE.Group {
  const g = new THREE.Group()

  const attach = (model: LoadedModel) => {
    const pouch = authoredProp(model, POUCH_SIZE, new THREE.Euler(0.1, 0.5, 0.06), undefined, false)
    /*
     * The stamp, pressed onto the front of the sack.
     *
     * Parented to the mesh and positioned in the *model's* unit space, so it
     * follows the resting tilt and the sizing without a second set of numbers
     * to keep in sync. Relief rather than texture: at this size a pressed
     * decal and a raised patch read identically, and a raised patch needs no
     * second material and no UV work on someone else's atlas.
     */
    const mesh = pouch.children[0] as THREE.Mesh
    const stamp = new THREE.Group()
    const fruit = ball(0.098, STAMP_RED, 1)
    fruit.scale.set(1, 0.92, 0.3)
    stamp.add(fruit)
    for (const a of [-0.7, 0, 0.7]) {
      const leaf = block(0.072, 0.026, 0.024, STAMP_GREEN, 0.01)
      leaf.position.set(Math.sin(a) * 0.042, 0.094 - Math.abs(a) * 0.018, 0.008)
      leaf.rotation.z = a * 0.9
      stamp.add(leaf)
    }
    /*
     * Onto the label the model already carries.
     *
     * The authored pouch turned out to have a stitched cream patch on its
     * front with a two-leaf sprout printed on it — which says "seeds" but not
     * *which* seeds, and the spec's whole point is that this mark identifies
     * the crop with no text anywhere on screen. So the tomato is pressed onto
     * that patch, sized to sit inside it rather than spill over its stitching —
     * and low on it, so the sprout the label already carries runs up into the
     * fruit and the two read as one plant rather than as a sticker over a
     * drawing. The calyx is still built here; the stalk is not, because the
     * label's own stem is already doing that job.
     */
    stamp.position.set(0, -0.1, 0.3)
    mesh.add(stamp)

    g.add(pouch)
  }

  const ready = peekModels()
  if (ready) attach(ready.seedPouch)
  else void loadModels().then((m) => attach(m.seedPouch)).catch((e) => console.warn('seed pouch never loaded', e))

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
 * Set an authored beach prop down on the sand.
 *
 * Three things every one of these needs and none of them ships with (the tide
 * line's glint is a fourth, wanted by the washups and not by the pouch):
 *
 *  - **A size.** Meshy normalises its exports into a unit box, so the shell,
 *    the shard and the branch all arrive exactly as big as each other, which is
 *    the one thing three objects from the same sea must not be. `longest` is
 *    the real-world size of the object's own longest axis, in world units,
 *    against a 1.6-unit castaway.
 *  - **A resting angle.** A washup sitting square to the world axes reads as
 *    *placed*; the sea does not place things. `tilt` is the lie of the object
 *    where the last wave dropped it.
 *  - **A ground contact.** Every factory in this file returns a group whose
 *    contact is at local y = 0, because that is the contract tideline.ts places
 *    against. The lift is measured from the bounding box *after* the tilt, or a
 *    rotated prop buries one end and floats the other.
 */
function authoredProp(
  model: LoadedModel,
  longest: number,
  tilt: THREE.Euler,
  material?: THREE.Material,
  sheened = true,
): THREE.Group {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(model.geometry, material ?? model.material)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const box = model.geometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  mesh.scale.setScalar(longest / Math.max(size.x, size.y, size.z))
  mesh.rotation.copy(tilt)
  mesh.updateMatrix()
  const rested = box.clone().applyMatrix4(mesh.matrix)
  mesh.position.y = -rested.min.y
  g.add(mesh)

  /*
   * The glint comes with it. Swapping a procedural washup for an authored one
   * changes what the object *is*, not the problem it has: on a broad ivory
   * beach at dawn, a small pale object against pale sand is invisible until
   * you are standing on it. Sized off the prop so the branch does not wear the
   * shard's spark, and parked on the high shoulder of the resting pose.
   */
  if (sheened) {
    /*
     * Dropped onto the prop's actual surface, not onto the top of its bounding
     * box. A tilted, rounded object's box corner is empty air — placed there,
     * the spark hangs above the shell with daylight under it and reads as a
     * second, floating object. One downward ray at build time costs nothing
     * and lands it on the shoulder of whatever shape the file happened to be.
     */
    const sheen = glint(THREE.MathUtils.clamp(longest * 0.12, 0.024, 0.045))
    const x = (rested.min.x + rested.max.x) * 0.22
    const z = (rested.min.z + rested.max.z) * 0.22
    const top = rested.max.y - rested.min.y
    const ray = new THREE.Raycaster(new THREE.Vector3(x, top + 1, z), new THREE.Vector3(0, -1, 0))
    mesh.updateMatrixWorld(true)
    const hit = ray.intersectObject(mesh, false)[0]
    sheen.position.set(x, hit ? hit.point.y : top * 0.8, z)
    sheen.rotation.z = 0.4
    g.add(sheen)
  }

  return g
}

/**
 * One tide-line washup by id. Session-one set: spiral shell, blue sea-glass,
 * driftwood stick — all three authored models now. Session-two set: rope coil,
 * odd fruit, and the impossible-colour sea-glass — the ONLY model here allowed
 * LOTTO_GOLD, because finding it *is* a lotto roll.
 *
 * The three authored ones resolve out of the shared model cache, which the boot
 * sequence has always finished long before beat 7 stages the tide line. When
 * they are not there yet — the dev gallery, which loads no glTF — the group
 * comes back empty and fills itself in when the fetch lands, rather than
 * carrying a second, divergent procedural copy of a model that has been
 * replaced.
 */
export function createWashupProp(id: TideDrop['id']): THREE.Group {
  const g = new THREE.Group()

  /** Build from the cache now, or as soon as there is a cache. */
  const authored = (pick: (m: ModelCache) => LoadedModel, longest: number, tilt: THREE.Euler) => {
    const ready = peekModels()
    if (ready) {
      g.add(authoredProp(pick(ready), longest, tilt))
      return
    }
    void loadModels()
      .then((models) => g.add(authoredProp(pick(models), longest, tilt)))
      .catch((e) => console.warn(`washup "${id}" never loaded`, e))
  }

  switch (id) {
    case 'spiral-shell': {
      /*
       * Palm-sized, and left close to the lie the file was authored in: this
       * one already models a shell resting on its lip, so the tilt is a nudge
       * off square rather than a pose. Tipping it up onto its edge (which the
       * first pass did) made it look balanced there by hand, which is the one
       * thing a washup must not look like.
       */
      authored((m) => m.spiralShell, 0.3, new THREE.Euler(0.12, 0.7, 0.09))
      break
    }

    case 'sea-glass': {
      /*
       * The smallest of the three, but not a pill — at 0.16 it read as a bead
       * beside a conch and a branch, and the set stopped looking like three
       * things the same sea left. Tipped so one face catches the low key
       * rather than presenting a flat plate to it.
       *
       * Its texture is retinted from the authored royal blue (#1d76ce), which
       * is a long way from this game's coastal palette and would have gone
       * further with postfx multiplying saturation by 1.2 on top. Frosted and
       * desaturated is also the fiction: this is glass the surf has been
       * tumbling for years.
       */
      authored((m) => m.seaGlass, 0.23, new THREE.Euler(1.42, 0.5, 0.35))
      break
    }

    case 'driftwood-stick': {
      // The longest of the set by a clear margin — the one that reads at a
      // distance and tells the player there is something on the wet band. It
      // is authored already lying down, so this is a roll off flat, no more,
      // to stop it reading like a dropped ruler.
      authored((m) => m.driftwoodStick, 0.52, new THREE.Euler(0.05, 0.9, 0.08))
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
      /*
       * Sea-glass in a colour the sea does not make. Small lotto, session two.
       *
       * Same authored shard as the ordinary sea-glass, and deliberately so —
       * the joke only lands if the player recognises the *object* and not the
       * colour. What is swapped is the material, not the mesh: the authored
       * royal-blue texture is dropped for flat lotto gold, because the reserved
       * colour has to arrive pure. Multiplying gold over that blue would give a
       * murky olive, which is neither sea glass nor a lotto tell.
       *
       * A hair larger than the ordinary shard, with a chip beside it, so the
       * find reads as *more* than the thing it echoes.
       */
      const goldGlass = new THREE.MeshLambertMaterial({
        color: LOTTO_GOLD,
        emissive: 0x403208,
        flatShading: true,
        transparent: true,
        opacity: 0.85,
      })
      const impossible = (longest: number, tilt: THREE.Euler) => {
        const ready = peekModels()
        if (ready) return Promise.resolve(authoredProp(ready.seaGlass, longest, tilt, goldGlass))
        return loadModels().then((m) => authoredProp(m.seaGlass, longest, tilt, goldGlass))
      }
      void impossible(0.27, new THREE.Euler(1.42, 0.5, 0.35)).then((o) => g.add(o))
      void impossible(0.13, new THREE.Euler(1.3, 1.6, 0.5)).then((o) => {
        o.position.set(0.18, 0, 0.1)
        g.add(o)
      })
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
