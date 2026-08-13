import * as THREE from 'three'
import { mat, ball, cyl, rng, MINOR_LAYER, setLayer } from '../style'
import { loadModels, peekModels, type LoadedModel, type ModelCache } from '../models'

/**
 * The clearable chaos set — the stars of the opening's core beat.
 *
 * Seven prop types the player pulls, sweeps, breaks, peels, crushes, pries and
 * picks out of the choked pocket at the treeline gap.
 *
 * Six of the seven are authored GLBs (`chaos-vine`, `chaos-frond`,
 * `chaos-driftwood`, `chaos-basket`, `chaos-stone`, `chaos-amphora`); the
 * morning-glory mat is still built from the shared style helpers plus flat leaf
 * cards. Every prop's *litter*, debris, burst and salt crust stays procedural
 * either way, because that is the half that has to match the world's palette
 * exactly and the half that has to animate independently of the mesh.
 *
 * Why the swap: the procedural vine was a stack of torus loops, which reads as
 * a tidy garden ornament rather than a snarl, and the procedural fronds — four
 * of them, from two seeds, arranged on open ground — photographed as a row of
 * tan croissants laid out beside the beds. Authored geometry fixes the first;
 * hard per-instance variance (see `serialOf`) fixes the second.
 *
 * An authored mesh cannot deform itself, so every act in the set is carried by
 * the GROUPS the mesh hangs in — a pivot on the ground the vine leans and necks
 * about, a hinge at the frond's butt that sweeps it away, two pivots either
 * side of a real geometric cut that break the branch in half, a compression
 * cage that crushes the basket, and a socket edge the stone is levered over.
 * See each builder for which channels stack into which act.
 *
 * ART DIRECTION (second pass — the first read as tidy garden ornaments on a
 * mown lawn, which is the opposite of the beat):
 *
 *  - **Value first.** The grass renders at roughly `#005E00` — a mid-dark,
 *    hugely saturated green. Anything mid-green and mid-value on top of it is
 *    invisible. So the set is built out of the two ends of the value scale
 *    instead: near-black twisted masses (vine cores, basalt) and bleached warm
 *    lights (dry fronds, driftwood, wicker, salt crust, pale leaf edges).
 *    Every prop carries both, so each one reads as a shape and not a smudge.
 *  - **Dead is warm, living is dark.** Fallen fronds and litter are ochre-tan
 *    dead matter, never lime. The living green that remains is pushed deep, and
 *    only leaf *edges* are allowed to be light.
 *  - **Mass, then mess.** Each prop is roughly half again the size of the first
 *    pass and carries a skirt of ground litter that spills past its footprint,
 *    so neighbouring props tangle into each other. Clearing one visibly opens a
 *    hole in something continuous — order made out of chaos, which is the whole
 *    thesis. The colliders (owned by ChaosPocket) stay tight to the core, so
 *    the mess never fences the player out of a tap.
 *  - **Grade-aware.** Postfx multiplies saturation by 1.2 and the dawn light
 *    returns a lit surface at roughly half its albedo, so colours here are
 *    authored bright-ish and a step desaturated. Basalt is near-black with
 *    white salt crust; the amphora shard is the only terracotta on screen;
 *    bougainvillea is the only magenta. NO gold — the reserved lotto colour
 *    never appears in chaos.
 *
 * Each prop is a rig with three verbs:
 *
 *  - `setStrain(t)` — the hold gesture's live feedback. The rig eases its
 *    *shown* strain toward the target through a damped spring, so a released
 *    hold wobbles elastically back to rest instead of snapping — the "it
 *    resists" feel the spec asks for, without the caller animating anything.
 *  - `playClear()` — the destruction: snap, sweep, crack, peel, crush, pop or
 *    lift, each authored per kind, each with its own duration. Exit animations
 *    are pure transforms driven by a 0..1 progress (never material opacity —
 *    `mat()` materials are cached and shared with the whole world, so fading
 *    one would fade the forest).
 *  - `update(dt, elapsed)` — drives both of the above plus a whisper of idle
 *    sway. The owning ChaosPocket calls it every frame.
 */

export type ChaosKind =
  | 'vine' | 'frond' | 'driftwood' | 'morning-glory' | 'basket' | 'stone' | 'amphora'

export interface ChaosPropRig {
  root: THREE.Group
  /** 0..1 elastic deform while held. Eases internally; safe to call at any rate. */
  setStrain(t: number): void
  /** Snap/crack/crush exit anim, then the root hides itself. */
  playClear(): void
  /** Advance strain spring, idle sway and the clear animation. (Additive to the
   *  contract shape — the pocket owns the frame loop, rigs never self-drive.) */
  update(dt: number, elapsed: number): void
}

/* ------------------------------------------------------------------ palette */

/*
 * Values are authored PRE-LIGHT.
 *
 * The session pins dawn at hour 7.2. The sun is barely off the horizon, so a
 * near-horizontal surface — a ground decal, a leaf lying flat — comes back at
 * roughly half its albedo, while an upright face keeps most of it. Authoring a
 * prop at the colour we want to *see* is therefore how the first pass ended up
 * with a pocket full of black holes: `#2A2622` basalt rendered at `#171513`,
 * which the eye files as a shadow bug rather than as rock.
 *
 * The reference is the grass the props stand on: it renders at about `#005E00`,
 * luminance ≈ 62. The set is built as a value pair against it —
 *
 *   dark half   vine cordage, basalt      ≈ 0.5–0.7 × grass luminance
 *   light half  dry frond, driftwood,     ≈ 1.5–1.8 × grass luminance
 *               wicker, salt, leaf edges
 *
 * — so every prop carries both and reads as a shape at a glance. Everything is
 * also a step desaturated, because postfx multiplies saturation by 1.2.
 */

/** Vine cordage: dark woody green. The dark half of the set's value pair. */
const VINE_BARK = 0x4a5a3c
const VINE_BARK_LIT = 0x5e6f4a
/** Living leaf, deep end of the spec ramp (#2E6B3A), lifted for the dawn. */
const LEAF_DEEP = 0x54874a
const LEAF_MID = 0x7bb45e
/** The pale edge — the light half of the pair. From #8FCF6B, lifted. */
const LEAF_PALE = 0xb0d18c
/** Leaves that died in the tangle: warm, dry, and never lime. */
const LEAF_DRY = 0xb08a4e
const LEAF_DEAD = 0x8d7148

/** Fallen palm frond — dead matter, ochre through bleached tan. The blade
 *  itself is authored now; these dress its torn leaflets and its litter. */
const FROND_DRY = 0xd2ae5f
const FROND_TAN = 0xe6cd96
const FROND_BROWN = 0xa8834a

/**
 * Sun-bleached driftwood.
 *
 * The first values (`#D6CDB8`) were nearly neutral, and a near-neutral pale
 * cylinder lying in a green pocket photographs as a length of plastic pipe —
 * the one prop in the set that did not read as anything that grew. Pulled warm
 * and down a step: still the second-lightest thing in the pocket, now
 * unmistakably wood the sea has had for a while.
 */
const DRIFT_PALE = 0xc9b391
const DRIFT_MID = 0xa38b68
const DRIFT_DARK = 0x776548

/** Morning-glory mat: deep runner green, pale leaf faces, periwinkle trumpets. */
const GLORY_DEEP = 0x4e8446
const GLORY_GREEN = 0x6fa859
const GLORY_LEAF = 0xa0cc7e
const GLORY_BLOOM = 0xa8b0dc

/** Woven wicker, lit and shadowed, plus the dark of a sprung stave. */
const WICKER = 0xc4a066
const WICKER_LIT = 0xdcbe88
const WICKER_DARK = 0x94734a

/** Volcanic basalt — authored to land on the spec's near-black #2A2622. */
const BASALT = 0x4a453e
const BASALT_LIT = 0x60594e
const SALT = 0xefece2
/**
 * Shading floor (see `shadedFloor`): the darkest value in the set, never a
 * void. Also the emissive floor put under the authored stone's own material —
 * see buildStone for why that prop specifically needs one.
 */
const BASALT_FLOOR = 0x1a1714

/**
 * The amphora shard — the opening's only terracotta (spec #C4693B), pulled
 * down in saturation and value.
 *
 * At the book value it photographed as a fluorescent orange fin sitting at the
 * pocket edge, and it was the second most saturated thing on screen after the
 * bougainvillea — which breaks the one job the gap's magenta has, to be the
 * only saturated warm anywhere near the treeline. This is a shard of a pot
 * that has been in salt water: still unmistakably terracotta, no longer
 * competing with the flowers for the eye.
 */
const TERRACOTTA = 0xa96346
const TERRACOTTA_IN = 0xbc8464

/** Bougainvillea — the only magenta on screen (spec #D14D8B), gap dressing. */
const BOUGAIN = 0xd14d8b
const BOUGAIN_DEEP = 0xa84071
const BOUGAIN_STEM = 0x5c4530

/* -------------------------------------------------------- leaf-card factory */

/**
 * Leaves are flat cards, not squashed spheres.
 *
 * A flattened icosahedron reads as a green pebble at any size; a tapered card
 * reads as a leaf even two pixels wide, because the silhouette carries the
 * information. One shared unit geometry (long axis on +Z, width on X, lying in
 * the XZ plane) is scaled per instance, so the whole pocket's foliage is a
 * couple of hundred instances of one buffer.
 */
let unitLeafGeo: THREE.BufferGeometry | null = null
function unitLeaf() {
  if (!unitLeafGeo) {
    const s = new THREE.Shape()
    s.moveTo(0, 0.5)
    s.bezierCurveTo(0.3, 0.26, 0.26, -0.3, 0, -0.5)
    s.bezierCurveTo(-0.26, -0.3, -0.3, 0.26, 0, 0.5)
    const g = new THREE.ShapeGeometry(s, 5)
    // Normalised to a 1×1 footprint (the bezier only reaches x = ±0.3), so
    // `leaf(len, wid)` means the world size it says it means. Un-normalised,
    // every leaf in the pocket came out 40 % narrower than authored, which is
    // exactly the difference between a leaf and a green sliver on screen.
    g.scale(1 / 0.6, 1, 1)
    g.rotateX(-Math.PI / 2)
    unitLeafGeo = g
  }
  return unitLeafGeo
}

/**
 * Double-sided lambert, cached locally.
 *
 * The shared `mat()` cache is front-side only, which is right for solid props
 * and wrong for a card: a single-sided leaf vanishes from half the orbit. These
 * live here rather than in style.ts so no other worker's file has to change.
 */
const cardCache = new Map<number, THREE.MeshLambertMaterial>()
function cardMat(color: number) {
  let m = cardCache.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
    cardCache.set(color, m)
  }
  return m
}

/**
 * A flat-shaded mesh with a floor under its shading.
 *
 * At hour 7.2 a face turned away from the sun receives essentially nothing, so
 * the darkest props in the set — basalt, vine cordage — lose their unlit sides
 * to pure black and stop being objects on screen. A few points of emissive set
 * a floor: lit faces are unchanged, shadowed ones settle at a warm near-black
 * you can still read a silhouette against. Same fix the loam patch needed,
 * applied to geometry instead of to a decal.
 */
function shadedFloor(geo: THREE.BufferGeometry, color: number, floor: number) {
  const m = new THREE.Mesh(geo, mat(color, { flat: true, emissive: floor }))
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/**
 * One leaf card: `len` along local Z, `wid` across local X.
 *
 * Rotation order is YXZ so the euler reads as (pitch, yaw, roll) *of the leaf*
 * — yaw spins it about the world's up, then pitch tips its tip up or down out
 * of level. In the default XYZ order the pitch is applied about a world axis
 * instead, so every leaf in a scatter tilts the same way regardless of which
 * way it is facing, and half of them end up edge-on to the camera.
 */
function leaf(len: number, wid: number, color: number) {
  const m = new THREE.Mesh(unitLeaf(), cardMat(color))
  m.scale.set(wid, 1, len)
  m.rotation.order = 'YXZ'
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/* ------------------------------------------------------- rig scaffolding */

/** Shared straight-down vector for the surface rays these rigs cast. */
const DOWN = new THREE.Vector3(0, -1, 0)

/** Default seconds the destruction animation runs before the root hides. */
const CLEAR_TIME = 0.42
/** Strain spring stiffness / damping — tuned for one visible overshoot wobble. */
const SPRING_K = 110
const SPRING_DAMP = 11

interface RigHooks {
  /** Apply the eased strain (may briefly overshoot past 1 or dip below 0). */
  strain(s: number, elapsed: number): void
  /** Apply the destruction at progress p (0..1). Absolute transforms only. */
  clear(p: number): void
  /** Optional at-rest breathing, applied before strain each frame. */
  idle?(elapsed: number): void
  /** Seconds the clear animation runs. Defaults to CLEAR_TIME. */
  time?: number
}

/**
 * Wrap a built prop group in the shared strain/clear state machine.
 *
 * The clear hooks are written as pure functions of progress, never as
 * accumulating deltas, so a rig restored mid-animation (tab hidden, resume,
 * jumpTo) can never drift away from its authored pose.
 */
function assembleRig(root: THREE.Group, hooks: RigHooks): ChaosPropRig {
  const clearTime = hooks.time ?? CLEAR_TIME
  let target = 0
  let shown = 0
  let vel = 0
  let clearT = -1
  return {
    root,
    setStrain(t: number) {
      target = Math.min(1, Math.max(0, t))
    },
    playClear() {
      if (clearT < 0) clearT = 0
    },
    update(dt: number, elapsed: number) {
      if (!root.visible) return
      if (clearT >= 0) {
        clearT += dt
        const p = Math.min(1, clearT / clearTime)
        hooks.clear(p)
        if (p >= 1) root.visible = false
        return
      }
      vel += (target - shown) * SPRING_K * dt
      vel *= Math.exp(-SPRING_DAMP * dt)
      shown += vel * dt
      if (shown < -0.18) shown = -0.18
      if (shown > 1.25) shown = 1.25
      hooks.idle?.(elapsed)
      hooks.strain(shown, elapsed)
    },
  }
}

/** A mesh that flies outward during the clear: its rest pose plus a direction. */
interface Flung {
  mesh: THREE.Mesh
  basePos: THREE.Vector3
  baseScale: THREE.Vector3
  dir: THREE.Vector3
}

function fling(f: Flung, p: number, reach: number, lift: number) {
  f.mesh.position.copy(f.basePos).addScaledVector(f.dir, p * reach)
  f.mesh.position.y = f.basePos.y + Math.sin(Math.min(1, p) * Math.PI) * lift
  f.mesh.scale.copy(f.baseScale).multiplyScalar(Math.max(0.001, 1 - p))
}

/* ------------------------------------------------ authored chaos meshes */

/**
 * Per-kind instance counter, mixed into every prop's seed.
 *
 * The pocket asks for five vines and four fronds out of three and two authored
 * `variant` numbers, so two vines and two fronds have always been built from an
 * identical seed. That cost nothing while the props were procedural knots seen
 * from across a clearing; with a single authored mesh apiece it means the same
 * object at the same angle twice in one pocket, which is most of why the fronds
 * read as a row of pastries. The serial gives each *instance* its own draw from
 * the same deterministic stream without touching `createChaosProp`'s signature.
 */
const serials = new Map<ChaosKind, number>()
function serialOf(kind: ChaosKind) {
  const n = (serials.get(kind) ?? 0) + 1
  serials.set(kind, n)
  return n
}

/**
 * How an authored mesh is fitted into a chaos rig.
 *
 * Meshy normalises its exports into a unit box, so size is never in the file:
 * every one of these arrives exactly as big as every other. `height` (an
 * upright snarl) or `longest` (something lying down) is the real world size,
 * against a 1.6-unit castaway.
 */
interface AuthoredPose {
  /** World height of the prop. Give this or `longest`, not both. */
  height?: number
  /** World size of the prop's own longest axis. */
  longest?: number
  /** Per-axis stretch on top of the fit. Identity between instances, not size. */
  stretch?: THREE.Vector3
  /** The resting lie, as (pitch, yaw, roll) of the prop — always YXZ. */
  tilt?: THREE.Euler
  /** Lateral sprawl off the rig's pivot, so the mass is not centred on it. */
  offset?: THREE.Vector2
  /** How far the prop beds into the soil, in world units. */
  sink?: number
}

/**
 * A posed authored mesh whose ground contact sits at local y = 0.
 *
 * That contract is the one every factory in these files keeps, because callers
 * place props with `groundHeight` and nothing else. The lift is measured from
 * the bounding box *after* the pose, or a tilted prop buries one end and floats
 * the other — and it is measured from the FULL model's box even when a partial
 * geometry is drawn, so two halves of one broken branch share a ground plane.
 */
function authoredMesh(model: LoadedModel, pose: AuthoredPose, geometry?: THREE.BufferGeometry) {
  const box = model.geometry.boundingBox!
  const size = box.getSize(new THREE.Vector3())
  const fit =
    pose.height !== undefined
      ? pose.height / size.y
      : (pose.longest ?? 1) / Math.max(size.x, size.y, size.z)

  const mesh = new THREE.Mesh(geometry ?? model.geometry, model.material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const st = pose.stretch
  mesh.scale.set(fit * (st?.x ?? 1), fit * (st?.y ?? 1), fit * (st?.z ?? 1))
  if (pose.tilt) mesh.rotation.copy(pose.tilt)
  mesh.updateMatrix()

  const rested = box.clone().applyMatrix4(mesh.matrix)
  mesh.position.set(pose.offset?.x ?? 0, -rested.min.y - (pose.sink ?? 0), pose.offset?.y ?? 0)
  return mesh
}

/**
 * Run `attach` against the model cache, now or as soon as it lands.
 *
 * The cache is always warm by beat 5 — boot finishes long before the player
 * reaches the pocket — so this is really for the dev gallery and the harness,
 * which render chaos props on a page that loads its glTF afterwards. The rig is
 * fully live either way: the strain and clear hooks drive the *groups*, which
 * exist from the first frame, so a mesh that arrives late simply appears
 * already correctly posed.
 */
function withModels(label: string, attach: (models: ModelCache) => void) {
  const ready = peekModels()
  if (ready) attach(ready)
  else void loadModels().then(attach).catch((e) => console.warn(`chaos "${label}" never loaded`, e))
}

/**
 * Cut a geometry in two along its local X axis, whole triangles either side.
 *
 * The driftwood's clear is a *break*, and a break on one authored mesh is only
 * honest if there are genuinely two pieces afterwards. Splitting by triangle
 * centroid gives two halves that reassemble into exactly the original branch at
 * rest — no coincident copies, no z-fighting, no fade-out standing in for a
 * snap. Each half is translated so its origin lands on the cut plane, which is
 * what lets a pivot group hinge it about the break.
 *
 * The exposed cut is left open. It is only ever seen for the few frames the
 * halves are flying apart, and the material is double-sided, so what shows is
 * the shadowed inside of the branch — which is what the inside of a snapped
 * branch looks like.
 */
function splitAlongX(geo: THREE.BufferGeometry, cut: number) {
  const src = geo.index ? geo.toNonIndexed() : geo
  const pos = src.getAttribute('position')
  const nrm = src.getAttribute('normal')
  const uv = src.getAttribute('uv')

  const tris: number[][] = [[], []]
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3
    tris[cx <= cut ? 0 : 1].push(t)
  }

  const half = (starts: number[]) => {
    const g = new THREE.BufferGeometry()
    const p = new Float32Array(starts.length * 9)
    const n = nrm ? new Float32Array(starts.length * 9) : null
    const u = uv ? new Float32Array(starts.length * 6) : null
    starts.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const s = t + k
        p.set([pos.getX(s), pos.getY(s), pos.getZ(s)], i * 9 + k * 3)
        if (n && nrm) n.set([nrm.getX(s), nrm.getY(s), nrm.getZ(s)], i * 9 + k * 3)
        if (u && uv) u.set([uv.getX(s), uv.getY(s)], i * 6 + k * 2)
      }
    })
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    if (n) g.setAttribute('normal', new THREE.BufferAttribute(n, 3))
    if (u) g.setAttribute('uv', new THREE.BufferAttribute(u, 2))
    // Origin on the cut plane, so a pivot at the break hinges the piece.
    g.translate(-cut, 0, 0)
    return g
  }

  return [half(tris[0]), half(tris[1])] as const
}

/**
 * A skirt of dead litter around a prop's feet.
 *
 * This is what makes the pocket look choked rather than decorated. Each piece
 * is a flat card or twig lying on the ground *past* the prop's own footprint,
 * so neighbours interleave and the eye cannot find where one object ends. It
 * rides the minor layer (never worth a water-reflection sample) and shrinks
 * away with its parent, so clearing one prop tidies its share of the ground.
 */
function litterSkirt(r: () => number, count: number, inner: number, outer: number) {
  const g = new THREE.Group()
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2
    const d = inner + r() * (outer - inner)
    const dead = r() < 0.62
    const piece = dead
      ? leaf(0.26 + r() * 0.26, 0.14 + r() * 0.1, r() < 0.5 ? LEAF_DRY : LEAF_DEAD)
      : leaf(0.24 + r() * 0.22, 0.15 + r() * 0.1, r() < 0.5 ? LEAF_DEEP : LEAF_PALE)
    piece.position.set(Math.cos(a) * d, 0.02 + r() * 0.03, Math.sin(a) * d)
    // Never dead flat: a leaf lying perfectly level at this sun angle is unlit.
    piece.rotation.set((r() - 0.5) * 0.6, r() * Math.PI * 2, (r() - 0.5) * 0.6)
    piece.castShadow = false
    g.add(piece)
  }
  for (let i = 0; i < Math.round(count * 0.4); i++) {
    const a = r() * Math.PI * 2
    const d = inner + r() * (outer - inner)
    const twig = cyl(0.011, 0.017, 0.2 + r() * 0.24, i % 2 === 0 ? LEAF_DEAD : VINE_BARK, 4)
    twig.position.set(Math.cos(a) * d, 0.022, Math.sin(a) * d)
    twig.rotation.set(Math.PI / 2, r() * Math.PI * 2, (r() - 0.5) * 0.4)
    twig.castShadow = false
    g.add(twig)
  }
  setLayer(g, MINOR_LAYER)
  return g
}

/* --------------------------------------------------------------- 1. vine */

/** Seconds the vine's snap runs — long enough for its chips to fly and settle. */
const VINE_CLEAR = 1.0
/**
 * Gravity on the torn chips, units/s².
 *
 * Nearly double the first pass, and the number that decides whether the snap
 * reads as *destruction* or as a party popper. Light debris hangs; hanging
 * debris is confetti. Torn matter goes up a little, turns over, and comes down
 * inside a second — which is also why the chips are given a ground floor to
 * settle on rather than being allowed to sink through the soil.
 */
const CHIP_GRAVITY = 8.2
/**
 * Chips thrown by one snap, and their size in world units.
 *
 * This is the third pass at this burst and the first that touches the *rig*.
 * The two before it retuned `playLeafBurst` in assets/opening/vfx.ts — the
 * shared-particle half of the effect — and the frame did not change, because
 * the loud thing was never the particles: it was the tangle's own foliage.
 * Every one of the ~18 leaves living in the knot (0.3–0.5 u long, a third of
 * the avatar's body, a third of them the canopy-pale `LEAF_PALE`) was launched
 * on a ballistic arc at the snap. Eighteen palm-sized lime cards tumbling out
 * of one prop is a party popper however carefully the particle system beside it
 * is tuned.
 *
 * So the foliage no longer flies at all — it collapses with the knot it grew on
 * — and the burst is its own population: thirty *scraps*, a quarter the length
 * of a leaf, dealt across jungle green and dry brown with the pale lime left
 * out entirely.
 */
const CHIP_COUNT = 30
const CHIP_LEN_MIN = 0.055
const CHIP_LEN_MAX = 0.125
const CHIP_WID_MIN = 0.032
const CHIP_WID_MAX = 0.072
/**
 * Chip tones: the shaded underside of a vine that has just been torn open, and
 * the dead matter it has been strangling. `LEAF_PALE` — the canopy face — is
 * deliberately absent: it is the value that made the old burst read lime, and a
 * leaf's lit face is not what shows when it is ripped off.
 */
const CHIP_COLORS = [LEAF_DEEP, LEAF_MID, LEAF_DEEP, LEAF_DRY, LEAF_DEAD, VINE_BARK_LIT]
/** Fraction of the clear window after which the chips fade out. */
const CHIP_FADE_FROM = 0.58
/** Height a settled chip rests at — just clear of the loam decal beneath it. */
const CHIP_REST = 0.025

/** One torn scrap: ballistic, spinning, and a pure function of progress. */
interface Chip {
  mesh: THREE.Mesh
  base: THREE.Vector3
  vel: THREE.Vector3
  spin: THREE.Vector3
  /** Seconds after the snap before this one launches. */
  delay: number
  /** Seconds of flight before it reaches the soil and stops moving. */
  land: number
}

/** Knee to thigh on a 1.6-unit castaway: the snarl you walk up to and rip out. */
const VINE_H_MIN = 0.58
const VINE_H_MAX = 0.86
/** Radians the whole tangle leans out of vertical at full strain. */
const VINE_LEAN = 0.2

/**
 * The authored vine tangle: one snarl of woody loops and dead leaf, hung in a
 * pivot group that does all the moving.
 *
 * A single authored mesh cannot bend its own segments the way the procedural
 * knot did, and pretending otherwise — scaling it evenly and calling that
 * strain — reads as a balloon inflating. What it CAN do is behave like
 * something rooted: the pivot sits on the ground at the rig origin, so every
 * rotation of the group moves the top of the snarl and leaves its base planted,
 * which is geometrically what a plant being pulled does. Four channels stack
 * into the hold:
 *
 *  - a **lean** toward one authored direction per instance (the player's pull),
 *  - a **stretch** up the Y axis with a matching pinch in X and Z, so the mass
 *    necks the way a fibrous thing does before it lets go,
 *  - a **wring**: a slow twist about Y, because the tangle is resisting,
 *  - a **shudder** at 26 rad/s riding on top of all three, scaled by strain.
 *
 * The litter skirt at its feet stays planted through all of it, and that is
 * what sells the deformation: the eye has a fixed reference an inch away from
 * the thing that is moving.
 *
 * The clear is a recoil-and-snap rather than a shrink — draw past the hold's
 * own maximum, whip back through vertical and out the other side as the fibres
 * part, then crush into the ground with a spin — and the thirty-chip leaf burst
 * (unchanged, see `CHIP_COUNT`) fires off the root through the whole window, so
 * the SFX and the VFX still land on real motion.
 */
function buildVine(variant: number): ChaosPropRig {
  const r = rng(101 + variant * 37 + serialOf('vine') * 811)
  const root = new THREE.Group()
  const tangle = new THREE.Group()
  const skirt = litterSkirt(r, 7, 0.45, 0.95)
  /*
   * The burst hangs off the ROOT, not off the tangle.
   *
   * `clear()` drives `tangle.scale` to nothing over the first third of the
   * window, and a child of the tangle is scaled by it — so the old burst was
   * crushed back into the knot's origin and popped out of existence at 0.34 s
   * no matter what velocities it had been given. Parented here it owns its own
   * second, which is what lets the chips actually fall and fade.
   */
  const debris = new THREE.Group()
  root.add(tangle, skirt, debris)

  /*
   * The snarl itself.
   *
   * Sized by HEIGHT rather than by its longest axis: the beat is "a thing at
   * knee height you walk up to", and the model is a low sprawling mass (its
   * footprint is nearly twice its height), so fitting the long axis would have
   * put a snarl on the grass you could step over.
   *
   * Everything that separates one of the five vines from the next lives here:
   * a height anywhere in the knee-to-thigh band, a non-uniform stretch that
   * makes each footprint its own oblong, a full random yaw so a different part
   * of the tangle faces the camera each time, and a tilt that beds it into the
   * ground at its own angle. Nothing else in the rig varies, and nothing here
   * is a per-variant lookup — with only three `variant` numbers across five
   * placements, a lookup would have produced two identical pairs.
   */
  const vineTilt = new THREE.Euler((r() - 0.5) * 0.22, r() * Math.PI * 2, (r() - 0.5) * 0.22, 'YXZ')
  const vineHeight = VINE_H_MIN + r() * (VINE_H_MAX - VINE_H_MIN)
  withModels('vine', (models) =>
    tangle.add(
      authoredMesh(models.chaosVine, {
        height: vineHeight,
        stretch: new THREE.Vector3(0.9 + r() * 0.34, 1, 0.88 + r() * 0.4),
        tilt: vineTilt,
        // Bedded in a finger's depth: a tangle that has been growing here sits
        // IN the litter, and it hides the flat underside of the export.
        sink: vineHeight * 0.06,
      }),
    ),
  )

  // The direction this one is pulled in. Rotating about +Z tips the top toward
  // −X and about +X toward +Z, so the lean is written across both channels.
  const pullA = r() * Math.PI * 2
  const leanX = Math.sin(pullA)
  const leanZ = -Math.cos(pullA)

  /*
   * The burst proper: small torn scraps, born inside the knot and thrown out
   * along the tear.
   *
   * Rig-local materials, because they have to fade. The shared `cardMat` cache
   * is used by every leaf in the pocket, so turning transparency on there would
   * make the whole clearing dissolve every time one vine let go. Six of them —
   * one per tone — is cheap and lets the whole spray fade as one event.
   */
  const chipMats = CHIP_COLORS.map(
    (color) =>
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, transparent: true }),
  )
  const chips: Chip[] = []
  for (let i = 0; i < CHIP_COUNT; i++) {
    const mesh = new THREE.Mesh(unitLeaf(), chipMats[i % chipMats.length])
    mesh.scale.set(
      CHIP_WID_MIN + r() * (CHIP_WID_MAX - CHIP_WID_MIN),
      1,
      CHIP_LEN_MIN + r() * (CHIP_LEN_MAX - CHIP_LEN_MIN),
    )
    mesh.rotation.order = 'YXZ'
    // Too small to cast anything legible, and thirty extra shadow casters per
    // vine is a real cost for a shadow the size of a fingernail.
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.visible = false
    setLayer(mesh, MINOR_LAYER)
    debris.add(mesh)

    const a = r() * Math.PI * 2
    // Lateral speed is held under 1.2 u/s so the spray stays inside a metre of
    // the tangle it came off: the burst has to point AT the thing that broke.
    const speed = 0.35 + r() * 0.85
    const radius = 0.05 + r() * 0.16
    const y0 = 0.3 + r() * 0.5
    const vy = 0.9 + r() * 1.5
    chips.push({
      mesh,
      base: new THREE.Vector3(Math.cos(a) * radius, y0, Math.sin(a) * radius),
      vel: new THREE.Vector3(Math.cos(a) * speed, vy, Math.sin(a) * speed),
      spin: new THREE.Vector3((r() - 0.5) * 15, (r() - 0.5) * 19, (r() - 0.5) * 15),
      delay: r() * 0.09,
      // Where the arc meets the soil, solved once rather than tested per frame
      // — the clear hook has to stay a pure function of progress, so a chip
      // cannot "notice" it has landed, it has to already know when it will.
      land: (vy + Math.sqrt(vy * vy + 2 * CHIP_GRAVITY * Math.max(0, y0 - CHIP_REST))) / CHIP_GRAVITY,
    })
  }

  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: VINE_CLEAR,
    strain(s, elapsed) {
      // The idle sway is folded in here rather than into `idle()`: this hook
      // writes the group's rotation absolutely, so anything the idle wrote
      // would be overwritten a line later.
      const sway = Math.sin(elapsed * 0.7 + variant * 2.1) * 0.03
      const shudder = Math.sin(elapsed * 26) * s
      const lean = VINE_LEAN * s
      tangle.rotation.set(
        leanX * lean + shudder * 0.03,
        sway + 0.16 * s + shudder * 0.02,
        leanZ * lean + shudder * 0.045,
      )
      // Necking: what goes up comes out of the waist.
      tangle.scale.set(1 - 0.12 * s, 1 + 0.28 * s, 1 - 0.12 * s)
      tangle.position.y = 0.05 * s
    },
    clear(p) {
      /*
       * Three overlapping phases inside the one-second window, all written as
       * pure functions of progress:
       *
       *   draw  0.00–0.16  one last over-stretch past the hold's own maximum
       *   snap  0.16–0.36  the release — whipped back THROUGH vertical and out
       *                    the far side, stretch collapsing into a squash
       *   fall  0.30–1.00  the crush: flattened into the soil, spinning, gone
       *
       * The whip is the whole point. A prop that stops moving and shrinks reads
       * as deleted; a prop that overshoots the other way reads as elastic that
       * finally parted, which is what the spec asks the vine to feel like.
       */
      const draw = Math.min(1, p / 0.16)
      const snap = Math.max(0, Math.min(1, (p - 0.16) / 0.2))
      const fall = Math.max(0, Math.min(1, (p - 0.3) / 0.7))

      const lean = VINE_LEAN * (1.35 * draw - 2.1 * snap)
      const spin = 0.16 + 0.9 * snap + 1.7 * fall * fall
      tangle.rotation.set(leanX * lean, spin, leanZ * lean)

      const gone = 1 - fall
      const girth = (1 + 0.36 * snap) * gone
      const stretch = 1 + 0.42 * draw - 0.95 * snap
      tangle.scale.set(
        Math.max(0.001, girth),
        Math.max(0.001, stretch * gone),
        Math.max(0.001, girth),
      )
      tangle.position.y = 0.05 * draw * (1 - snap) - 0.05 * fall
      skirt.scale.setScalar(Math.max(0.001, gone))

      // One fade for the whole spray: the chips go together, so the eye reads
      // the burst dissolving rather than thirty objects each ending separately.
      const fade = Math.max(0, (p - CHIP_FADE_FROM) / (1 - CHIP_FADE_FROM))
      const alpha = Math.max(0, 1 - fade * fade)
      for (const m of chipMats) m.opacity = alpha

      const now = p * VINE_CLEAR
      for (const c of chips) {
        const raw = now - c.delay
        if (raw <= 0) {
          c.mesh.visible = false
          continue
        }
        // Frozen at the landing: a scrap that fell is *lying there*, which is
        // the whole difference between debris and a particle system. Tumbling
        // stops with the flight, or the chips look like they are still falling
        // after they have arrived.
        const t = Math.min(raw, c.land)
        c.mesh.visible = alpha > 0.01
        c.mesh.position.set(
          c.base.x + c.vel.x * t,
          Math.max(CHIP_REST, c.base.y + c.vel.y * t - 0.5 * CHIP_GRAVITY * t * t),
          c.base.z + c.vel.z * t,
        )
        c.mesh.rotation.set(c.spin.x * t, c.spin.y * t, c.spin.z * t)
      }
    },
  })
}

/* -------------------------------------------------------------- 2. frond */

/** The blade's own length in world units — a metre and a half to over two. */
const FROND_LEN_MIN = 1.45
const FROND_LEN_MAX = 2.15

/**
 * A fallen palm frond: one authored dry blade lying where it fell, plus the
 * leaflets that have already torn off it.
 *
 * THE DEFECT THIS PASS EXISTS TO FIX. Four fronds are placed in and around the
 * pocket, from two `variant` numbers, and the procedural build gave each variant
 * one fixed pose — so the clearing contained two matched pairs of identical tan
 * objects, each sitting square in its own patch of clear grass. Read back off
 * two separate screenshots, that is a tray of croissants, not chaos. Three
 * things are done about it here and all three matter:
 *
 *  - **Every instance is its own draw.** Length, width, thickness, yaw, pitch,
 *    roll and sink are sampled per prop off a serial-mixed seed (`serialOf`),
 *    not looked up per variant. No two fronds in the pocket share a pose.
 *  - **They sprawl off their own pivot.** The blade is offset up to half a metre
 *    from the rig origin at a random bearing, and its torn leaflets scatter out
 *    past a metre, so a frond's mass overlaps its neighbours and the litter of
 *    the props beside it. Nothing sits in a clear ring any more. The collider
 *    stays a 0.35 circle on the origin, so the sprawl never fences the player.
 *  - **They lie down.** Pitch and roll are kept under a fifth of a radian: a
 *    frond is a dead thing on the ground, and the pastry read came partly from
 *    props that sat up off it. Contact is recomputed after the tilt, so the low
 *    edge rests on the soil instead of hovering over it.
 *
 * The quickest act in the set, and the lightest: the hold drags it a few
 * degrees with a dry 34 rad/s rustle, and the clear is a sweep — the blade
 * swings about the pivot, skips off the ground and away, and the loose leaflets
 * scatter out from under it.
 */
function buildFrond(variant: number): ChaosPropRig {
  const r = rng(211 + variant * 53 + serialOf('frond') * 977)
  const root = new THREE.Group()
  const blade = new THREE.Group()
  // Wide and thin on purpose: the skirt is what knits one prop's footprint into
  // the next, and the frond is the prop most often on the pocket's rim.
  const skirt = litterSkirt(r, 6, 0.55, 1.35)
  root.add(blade, skirt)

  const bearing = r() * Math.PI * 2
  const reach = 0.18 + r() * 0.42
  withModels('frond', (models) =>
    blade.add(
      authoredMesh(models.chaosFrond, {
        longest: FROND_LEN_MIN + r() * (FROND_LEN_MAX - FROND_LEN_MIN),
        stretch: new THREE.Vector3(0.78 + r() * 0.5, 0.85 + r() * 0.45, 1),
        // Pitch and roll only. The yaw belongs to the blade group, which is
        // also the thing that sweeps — see the note on rotation order below.
        tilt: new THREE.Euler((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.62, 'YXZ'),
        offset: new THREE.Vector2(Math.cos(bearing) * reach, Math.sin(bearing) * reach),
        sink: 0.015,
      }),
    ),
  )

  /*
   * Leaflets already torn off, thrown well past the blade's own footprint.
   *
   * These are the prop's overlap with its neighbours, and they are also its
   * scatter: they are children of `root`, not of `blade`, so the sweep leaves
   * them behind for a moment and then flings them, which is what turns "the
   * object left" into "something was ripped up here".
   */
  const scatter: Flung[] = []
  const nLoose = 4 + Math.floor(r() * 3)
  for (let i = 0; i < nLoose; i++) {
    const a = r() * Math.PI * 2
    const d = 0.35 + r() * 0.75
    const l = leaf(0.34 + r() * 0.3, 0.13 + r() * 0.08, r() < 0.45 ? FROND_BROWN : FROND_DRY)
    l.position.set(Math.cos(a) * d, 0.02 + r() * 0.03, Math.sin(a) * d)
    l.rotation.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.45)
    l.castShadow = false
    root.add(l)
    scatter.push({
      mesh: l,
      basePos: l.position.clone(),
      baseScale: l.scale.clone(),
      dir: new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)).normalize(),
    })
  }

  root.rotation.y = r() * Math.PI * 2
  /*
   * The blade group carries the frond's yaw AND is the animation group, in YXZ
   * order — so the yaw applies outermost and the pitch channel below tips the
   * blade about its OWN long axis rather than about a world axis. Written the
   * other way round (yaw on the mesh, pitch on the group) a frond lying east
   * would lift its tip and a frond lying north would roll onto its side from
   * the same number.
   */
  blade.rotation.order = 'YXZ'
  const baseYaw = r() * Math.PI * 2
  blade.rotation.y = baseYaw
  const sweepDir = new THREE.Vector3(Math.sin(bearing + 1.4), 0, Math.cos(bearing + 1.4))
  return assembleRig(root, {
    time: 0.45,
    strain(s, elapsed) {
      // Dry and fast: a frond does not stretch, it rattles and drags.
      const rustle = Math.sin(elapsed * 34) * 0.045 * s
      blade.rotation.set(-0.06 * s, baseYaw + 0.3 * s + rustle, 0.05 * s + rustle * 0.4)
      blade.position.y = 0.03 * s
      skirt.rotation.y = s * 0.1
    },
    clear(p) {
      // One sweep, away and over: it swings about the pivot, skips off the
      // ground and rolls as it goes.
      blade.rotation.set(-0.06 - p * 0.55, baseYaw + 0.3 + p * 2.3, 0.05 + p * 0.8)
      blade.position.copy(sweepDir).multiplyScalar(p * 1.05)
      blade.position.y = 0.03 + Math.sin(p * Math.PI) * 0.24
      blade.scale.setScalar(Math.max(0.001, 1 - p * p))
      for (const f of scatter) fling(f, p, 0.7, 0.22)
      skirt.scale.setScalar(Math.max(0.001, 1 - p))
    },
  })
}

/* ---------------------------------------------------------- 3. driftwood */

/** A two-handed branch, not a twig: metre and a half to two metres of it. */
const DRIFT_LEN_MIN = 1.5
const DRIFT_LEN_MAX = 2.0

/**
 * The breakable branch — the one prop in the pocket whose clear is a *break*.
 *
 * The spec's act here is a hold-break dropping wood ×2, and the payout is only
 * honest if there are two pieces at the end of it. So the authored mesh is cut
 * in half at build time (`splitAlongX`, along its long axis, at a jittered
 * point either side of the middle) and the two halves are hung in pivot groups
 * that both sit ON the cut plane. At rest they reassemble into exactly the
 * branch that was exported — one continuous silhouette, no seam, no doubled
 * geometry — and the moment the player finishes the hold there are genuinely
 * two objects to throw.
 *
 *  - `setStrain` **bows** it: the halves hinge a few degrees the same way about
 *    the break, so the branch flexes and quivers, the way wood does right
 *    before it goes. A single stiff mesh cannot do this at all, which is the
 *    reason for the cut beyond the payout.
 *  - `playClear` **breaks** it: the bow snaps through in a tenth of a second,
 *    the halves counter-rotate hard about the break, and they arc apart and
 *    away from each other. They only start shrinking a third of the way in,
 *    after the eye has already read two separate pieces of wood in flight.
 *
 * Everything inside the `lie` group is authored in MODEL units (the branch is
 * one unit long there), so every distance below is a fraction of the branch's
 * own length and the break looks identical at any size.
 */
function buildDriftwood(variant: number): ChaosPropRig {
  const r = rng(307 + variant * 41 + serialOf('driftwood') * 641)
  const root = new THREE.Group()
  const skirt = litterSkirt(r, 5, 0.5, 1.15)
  root.add(skirt)

  /*
   * `lie` holds the whole branch's pose — length, thickness, the angle it came
   * to rest at, and the lift that puts its lowest point on the soil. The two
   * half pivots live inside it, so their hinge axis is the branch's own, not
   * the world's: a branch lying north-south breaks the same way as one lying
   * east-west.
   */
  const lie = new THREE.Group()
  lie.rotation.order = 'YXZ'
  lie.rotation.set((r() - 0.5) * 0.2, r() * Math.PI * 2, (r() - 0.5) * 0.34)
  const halfA = new THREE.Group()
  const halfB = new THREE.Group()
  lie.add(halfA, halfB)
  root.add(lie)

  const length = DRIFT_LEN_MIN + r() * (DRIFT_LEN_MAX - DRIFT_LEN_MIN)
  const girth = 0.85 + r() * 0.4
  // Off-centre, so the two pieces are visibly a long one and a short one — a
  // branch that snaps into two equal halves looks manufactured.
  const cut = (r() - 0.5) * 0.3

  withModels('driftwood', (models) => {
    const model = models.chaosDriftwood
    const box = model.geometry.boundingBox!
    const size = box.getSize(new THREE.Vector3())
    const fit = length / size.x
    lie.scale.set(fit, fit * girth, fit * girth)

    const [geoA, geoB] = splitAlongX(model.geometry, cut)
    for (const [pivot, geo] of [
      [halfA, geoA],
      [halfB, geoB],
    ] as const) {
      const mesh = new THREE.Mesh(geo, model.material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      pivot.position.x = cut
      pivot.add(mesh)
    }

    // Ground contact, measured on the assembled branch after its pose — the two
    // halves share one plane because they share one parent.
    lie.updateMatrix()
    lie.position.y = -box.clone().applyMatrix4(lie.matrix).min.y
  })

  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      const quiver = Math.sin(elapsed * 22) * 0.04 * s
      halfA.rotation.z = 0.13 * s + quiver
      halfB.rotation.z = -0.13 * s - quiver
      root.position.y = 0.02 * s
    },
    clear(p) {
      /*
       * The crack is the first tenth: the bow reverses through zero and the
       * halves kick apart. After that they are simply two pieces of wood in the
       * air, tumbling on their own axes.
       */
      const crack = Math.min(1, p / 0.1)
      const fly = Math.max(0, (p - 0.08) / 0.92)
      const hinge = 0.13 - 1.5 * crack - 1.1 * fly

      halfA.rotation.set(fly * 0.7, -fly * 0.5, hinge)
      halfB.rotation.set(-fly * 0.6, fly * 0.6, -hinge)
      // Apart along the branch, and outward: fractions of its own length.
      halfA.position.set(-fly * 0.34, Math.sin(Math.min(1, fly * 1.2) * Math.PI) * 0.3, -fly * 0.12)
      halfB.position.set(fly * 0.34, Math.sin(Math.min(1, fly * 1.15) * Math.PI) * 0.32, fly * 0.14)
      // Held at full size through the first third — the read is "it broke in
      // two", and it needs the frames to land before anything starts leaving.
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.35) / 0.65))
      halfA.scale.setScalar(s)
      halfB.scale.setScalar(s)
      skirt.scale.setScalar(Math.max(0.001, 1 - p))
    },
  })
}

/* ------------------------------------------------------ 4. morning glory */

/**
 * A beach morning-glory runner grown flat over the ground: a mat you can read
 * the individual leaves of, threaded with dark runners and dotted with soft
 * periwinkle trumpets. The first pass was six flattened spheres, which at this
 * camera height is a green puddle; the leaf cards are what make it a plant.
 *
 * It peels like turf — the sheet pivots up about its west edge while the player
 * holds, and the clear rolls it right over and away.
 */
function buildMorningGlory(variant: number): ChaosPropRig {
  const r = rng(419 + variant * 29)
  const root = new THREE.Group()
  // Pivot sits on the sheet's edge so the peel hinges like lifted turf.
  const sheet = new THREE.Group()
  sheet.position.set(-0.75, 0.02, 0)
  root.add(sheet)

  // Runners: the dark structure the leaves hang off.
  for (let i = 0; i < 5; i++) {
    const run = cyl(0.014, 0.02, 0.7 + r() * 0.6, GLORY_DEEP, 4)
    run.rotation.z = Math.PI / 2
    run.rotation.y = (r() - 0.5) * 1.1
    run.position.set(0.6 + (r() - 0.5) * 0.5, 0.035, (r() - 0.5) * 1.1)
    sheet.add(run)
  }
  // Leaves: heart-ish cards at every angle, overlapping into a mat. Each one is
  // cocked well off level — a card lying flat at this sun angle is a grey
  // smudge, and a mat of grey smudges is what the first pass looked like.
  for (let i = 0; i < 22; i++) {
    const tone = r()
    const l = leaf(
      0.3 + r() * 0.16,
      0.26 + r() * 0.14,
      tone < 0.32 ? GLORY_LEAF : tone < 0.72 ? GLORY_GREEN : GLORY_DEEP,
    )
    l.position.set(0.08 + r() * 1.3, 0.06 + r() * 0.08, (r() - 0.5) * 1.35)
    l.rotation.set(-0.35 - r() * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5)
    l.castShadow = false
    sheet.add(l)
  }
  for (let i = 0; i < 6; i++) {
    const bloom = cyl(0.075, 0.014, 0.11, GLORY_BLOOM, 7)
    bloom.position.set(0.2 + r() * 1.1, 0.12, (r() - 0.5) * 1.2)
    bloom.rotation.set((r() - 0.5) * 0.7, 0, (r() - 0.5) * 0.7)
    sheet.add(bloom)
  }

  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      sheet.rotation.z = s * 0.7 + Math.sin(elapsed * 20) * 0.03 * s
    },
    clear(p) {
      // Peel right over, rolling up as it goes, then shrink out.
      sheet.rotation.z = 0.7 + p * 1.5
      sheet.scale.x = Math.max(0.05, 1 - p * 0.8)
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.5) / 0.5))
      sheet.scale.y = s
      sheet.scale.z = s
    },
  })
}

/* -------------------------------------------------------------- 5. basket */

/** Knee-height at most — a basket tipped over, not a barrel. */
const BASKET_H_MIN = 0.48
const BASKET_H_MAX = 0.64

/**
 * The broken basket: the authored weave, tipped over where somebody dropped it,
 * with its sprung staves lying loose around it.
 *
 * This is the spec's *surprise inside chaos* — the crush that gives up a spiral
 * shell along with its fibre, and the beat that teaches, once and without a
 * word, that clearing contains gifts. The whole animation is built around
 * getting out of the way of that reveal.
 *
 *  - The **crush** is a compression, not a shrink: the basket squats, its walls
 *    bulge out under the load, and it flattens to a fifth of its height by
 *    p = 0.45. Whatever is left after that is a mat of weave on the soil.
 *  - The sprung staves fly LOW and OUTWARD — `fling` with barely any lift —
 *    because the pocket spawns the shell at the prop's own position the instant
 *    the clear begins (`onClear` in game/opening/chaos-pocket.ts, which is not
 *    this file's to change) and the drop arcs up out of it. The column of air
 *    directly above the basket is the shell's, and nothing here is allowed in
 *    it. The old rig threw its sticks up at 0.55 of their reach; these go up at
 *    0.16 of it.
 *  - Nothing is left standing after p = 0.5 to occlude the arc.
 */
function buildBasket(variant: number): ChaosPropRig {
  const r = rng(523 + variant * 31 + serialOf('basket') * 733)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const height = BASKET_H_MIN + r() * (BASKET_H_MAX - BASKET_H_MIN)
  withModels('basket', (models) =>
    body.add(
      authoredMesh(models.chaosBasket, {
        height,
        stretch: new THREE.Vector3(0.92 + r() * 0.22, 1, 0.92 + r() * 0.22),
        // Tipped and settled, never square to the world: a basket somebody
        // dropped and walked away from, not one set down.
        tilt: new THREE.Euler(0.2 + r() * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.5, 'YXZ'),
        sink: height * 0.05,
      }),
    ),
  )

  /*
   * Weave ends sprung out of the rim, procedural because they have to move
   * independently of the mesh and because wicker is the one colour in this set
   * that has to match a texture rather than the grass. They also break the
   * authored silhouette, which a single tipped basket badly needs.
   */
  const sticks: Flung[] = []
  const R = height * 0.62
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2
    const stick = cyl(0.013, 0.019, 0.3 + r() * 0.24, i % 2 === 0 ? WICKER_DARK : WICKER, 4)
    stick.position.set(Math.cos(a) * R, 0.06 + r() * 0.2, Math.sin(a) * R)
    stick.rotation.set((r() - 0.5) * 1.3, a, 0.8 + r() * 0.6)
    root.add(stick)
    sticks.push({
      mesh: stick,
      basePos: stick.position.clone(),
      baseScale: stick.scale.clone(),
      dir: new THREE.Vector3(Math.cos(a), 0.16, Math.sin(a)).normalize(),
    })
  }
  // A course of weave that has already come off, lying flat beside it.
  const loose = new THREE.Mesh(
    new THREE.TorusGeometry(R * 0.8, 0.026, 5, 12, Math.PI * (1.1 + r() * 0.5)),
    mat(WICKER_LIT),
  )
  loose.castShadow = true
  loose.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.3, 0, r() * Math.PI * 2)
  loose.position.set((r() - 0.5) * 0.7, 0.03, (r() - 0.5) * 0.7)
  root.add(loose)

  root.add(litterSkirt(r, 5, 0.5, 1.05))
  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      // Giving under the hands: down, and out at the waist.
      body.scale.set(1 + 0.16 * s, 1 - 0.34 * s, 1 + 0.16 * s)
      body.rotation.y = Math.sin(elapsed * 24) * 0.05 * s
      body.position.y = -0.02 * s
    },
    clear(p) {
      /*
       * Flattened to a tenth of its height by p = 0.45, and bulging half again
       * as wide on the way down. The first pass of this took it to a third and
       * read as a basket settling rather than as one giving way — a crush has
       * to end below the height of the weave lying beside it.
       */
      const crush = Math.min(1, p / 0.45)
      const flat = 0.66 - crush * 0.58
      body.scale.set(1.16 + crush * 0.42, Math.max(0.04, flat), 1.16 + crush * 0.42)
      body.position.y = -0.02 * (1 - crush)
      // Only after the collapse has read: the mat sinks away while the shell
      // is already on its way up.
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.55) / 0.45))
      body.scale.multiplyScalar(s)
      for (const f of sticks) fling(f, p, 0.85, 0.1)
      loose.scale.setScalar(Math.max(0.001, 1 - Math.max(0, (p - 0.4) / 0.6)))
    },
  })
}

/* --------------------------------------------------------------- 6. stone */

/** The boulder's longest axis in world units — knee-high, wider than tall. */
const STONE_LEN_MIN = 0.9
const STONE_LEN_MAX = 1.2
/** Seconds the pry runs: pop, land, wobble, settle. Longer than the rest. */
const STONE_CLEAR = 0.72

/**
 * The half-sunk basalt stone, authored — with its salt crust still built here.
 *
 * VALUE, which is the whole problem with this prop. The file's palette note
 * records what happened the last time this stone was authored at the spec's
 * `#2A2622`: at hour 7.2 a near-horizontal dark surface comes back at about
 * half its albedo, so the rock rendered near `#171513` and the eye filed it as
 * a shadow bug rather than as basalt — a pocket full of black holes. The
 * authored texture averages `#332f2a`, brighter than that failure but still
 * genuinely dark, so the two things that saved the procedural version are kept
 * on top of it: a small emissive floor on the material, so a face turned away
 * from the low sun settles at a warm near-black you can read a silhouette
 * against rather than at nothing, and the white salt crust, which is the only
 * pure white in the opening and is what makes the mass read as *rock* — a dark
 * thing with a light thing on it is an object, a dark thing alone is a hole.
 *
 * The act is the shovel pry: `setStrain` levers the stone in its socket about
 * one edge — it tips and grinds rather than rising — and `playClear` pops it
 * free, drops it, and lets it WOBBLE-SETTLE on the soil before it goes. That
 * last third is the part that sells the weight: everything else in the pocket
 * leaves at speed, and the stone is the one thing that lands.
 */
function buildStone(variant: number): ChaosPropRig {
  const r = rng(631 + variant * 43 + serialOf('stone') * 557)
  const root = new THREE.Group()
  /*
   * The socket edge the shovel levers against, offset from the rig origin, so
   * the strain is a genuine pry — the far side lifts, the near side stays down
   * in the ground. Rocking the stone about its own centre reads as a wobbling
   * ball.
   */
  const lever = new THREE.Group()
  root.add(lever)
  const rock = new THREE.Group()
  lever.add(rock)

  const length = STONE_LEN_MIN + r() * (STONE_LEN_MAX - STONE_LEN_MIN)
  const socket = 0.3 + r() * 0.12
  lever.position.set(-socket * length * 0.5, 0, 0)
  rock.position.set(socket * length * 0.5, 0, 0)

  /*
   * Salt crust on the crown and the weather side — flat patches, not blobs.
   *
   * Built BEFORE the model attaches, and deliberately so: with the cache warm
   * (which is every case in the game) `withModels` runs its callback
   * synchronously, so anything that callback touches has to already exist. The
   * heights below are placeholders — the ray in the callback drops each patch
   * onto the rock's real surface the moment there is a rock.
   */
  const crust: THREE.Mesh[] = []
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2
    const patch = ball(length * (0.09 + r() * 0.06), SALT, 0)
    patch.scale.set(1.25, 0.16, 1)
    patch.position.set(Math.cos(a) * length * 0.2, length * 0.3, Math.sin(a) * length * 0.16)
    patch.rotation.set((r() - 0.5) * 0.3, a, (r() - 0.5) * 0.3)
    rock.add(patch)
    crust.push(patch)
  }

  withModels('stone', (models) => {
    const mesh = authoredMesh(models.chaosStone, {
      longest: length,
      stretch: new THREE.Vector3(1, 0.88 + r() * 0.3, 1),
      tilt: new THREE.Euler((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4, 'YXZ'),
      // Half-buried, per the spec. This is the only prop in the set that is
      // meant to be substantially IN the ground rather than on it.
      sink: length * 0.14,
    })
    /*
     * The emissive floor, applied to a material of this rig's own. The shared
     * cache hands every stone the same instance, and lifting that one would
     * lift the copy the tide line and the gallery draw as well — so this is
     * cloned, which costs one material and keeps the texture upload shared.
     */
    const lifted = (mesh.material as THREE.MeshStandardMaterial).clone()
    lifted.emissive = new THREE.Color(BASALT_FLOOR)
    lifted.emissiveIntensity = 1
    mesh.material = lifted
    rock.add(mesh)

    /*
     * Salt crust, dropped onto the rock's own surface with one downward ray
     * each — the same trick the tide-line glint uses in beach-models.ts, and
     * for the same reason: an authored boulder's bounding-box top is empty air
     * over most of its footprint, so crust placed at that height hovers, and
     * crust placed at a guessed fraction of it disappears inside the mesh. Both
     * failures are invisible in code and obvious in a screenshot.
     *
     * This is the prop's LIGHT HALF and it is load-bearing. Basalt is the
     * darkest thing in the opening; at hour 7.2 a dark mass with nothing bright
     * on it reads as a hole in the grass rather than as a rock (see the palette
     * note at the top of this file). Five white patches is the difference.
     */
    mesh.updateMatrixWorld(true)
    const top = new THREE.Box3().setFromObject(mesh).max.y
    const ray = new THREE.Raycaster()
    for (const patch of crust) {
      ray.set(new THREE.Vector3(patch.position.x, top + 1, patch.position.z), DOWN)
      const hit = ray.intersectObject(mesh, false)[0]
      // Just proud of the surface, or the patch z-fights the face it sits on.
      patch.position.y = (hit ? hit.point.y : top * 0.85) - length * 0.01
    }
  })

  // Spalled chips at the foot, left behind on the soil.
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2
    const chip = shadedFloor(
      new THREE.IcosahedronGeometry(length * (0.06 + r() * 0.04), 0),
      i % 2 === 0 ? BASALT : BASALT_LIT,
      BASALT_FLOOR,
    )
    chip.scale.set(1.1, 0.5, 0.9)
    chip.position.set(Math.cos(a) * (0.42 + r() * 0.2), 0.03, Math.sin(a) * (0.42 + r() * 0.2))
    chip.rotation.y = a
    root.add(chip)
  }

  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: STONE_CLEAR,
    strain(s, elapsed) {
      // Grinding in its socket: it tips further with the strain and shudders
      // against the grit, and it barely rises until it lets go.
      const grind = Math.sin(elapsed * 19) * 0.05 * s
      lever.rotation.z = -0.34 * s + grind
      lever.rotation.x = Math.cos(elapsed * 16) * 0.05 * s
      lever.position.y = 0.03 * s
    },
    clear(p) {
      /*
       *   pop     0.00–0.30  it comes out of the socket, over the lip
       *   land    0.30–0.55  down onto the soil beside the hole
       *   settle  0.55–1.00  two damped rocks and it is still
       *
       * The settle is written as a decaying cosine rather than as keyframes so
       * the amplitude and the rate can be read off the line: a fifth of a
       * radian, dying over the last four tenths of a second.
       */
      const pop = Math.min(1, p / 0.3)
      const land = Math.max(0, Math.min(1, (p - 0.3) / 0.25))
      const rest = Math.max(0, (p - 0.55) / 0.45)

      const hop = Math.sin(Math.min(1, p / 0.55) * Math.PI) * 0.34
      lever.position.y = 0.03 + hop
      lever.position.x = (pop * 0.18 + land * 0.12) * 0.6
      const tumble = -0.34 - pop * 0.9 - land * 0.5
      const wobble = rest > 0 ? Math.cos(rest * Math.PI * 3.4) * 0.2 * (1 - rest) * (1 - rest) : 0
      lever.rotation.z = tumble * (1 - rest * 0.55) + wobble
      lever.rotation.x = wobble * 0.5

      // It stays whole almost to the end — the stone is the heaviest thing in
      // the pocket and it has to look like it stopped, not like it evaporated.
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.82) / 0.18))
      rock.scale.setScalar(s)
    },
  })
}

/* ------------------------------------------------------------- 7. amphora */

/**
 * The terracotta amphora shard — tap-collect, kept whole, the player's first
 * keepable. A curved fragment of pot wall with a painted band still on it and a
 * paler unglazed inner face, plus one small splinter beside it, so it reads as
 * *somebody's civilisation broke here* and not as an orange rock.
 *
 * No strain (tap is a discrete act); the clear is the collect: it lifts, spins
 * once, and is gone to the satchel.
 */
function buildAmphora(variant: number): ChaosPropRig {
  const r = rng(733 + variant * 17 + serialOf('amphora') * 419)
  const root = new THREE.Group()
  const piece = new THREE.Group()
  root.add(piece)

  /*
   * A fragment, not a pot: a hand's span across, part-buried at the pocket
   * edge. Sized deliberately below every other authored prop in the set — it is
   * the one object here the player is meant to walk over to and pick UP, and a
   * keepsake that reads as furniture is not a keepsake.
   *
   * Buried a fifth of its depth. The tap is a discrete act with no hold to
   * telegraph it, so the shard has to look like it has been lying here since
   * long before the player arrived, and something resting cleanly on top of the
   * soil looks placed this morning.
   */
  const span = 0.4 + r() * 0.12
  withModels('amphora', (models) =>
    piece.add(
      authoredMesh(models.chaosAmphora, {
        longest: span,
        tilt: new THREE.Euler(0.18 + (r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.4, 'YXZ'),
        sink: span * 0.06,
      }),
    ),
  )

  // A splinter that broke off it, left in the dirt beside it — still built
  // here, because two pieces is what says "this broke" rather than "this is a
  // curved orange object", and one authored mesh cannot say it alone.
  const splinter = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 7, 5, 0, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.4),
    new THREE.MeshLambertMaterial({ color: TERRACOTTA, side: THREE.DoubleSide }),
  )
  splinter.castShadow = true
  splinter.rotation.set(2.1, r() * Math.PI * 2, 0.4)
  splinter.position.set(0.3 + r() * 0.14, 0.02, -0.18 + r() * 0.3)
  root.add(splinter)

  return assembleRig(root, {
    time: 0.5,
    strain() {
      /* Tap-collect: the shard never strains. ChaosPocket surfaces it through
         tapTargetNear(), not holdTargets(), so this hook is never driven. */
    },
    clear(p) {
      // The collect: it lifts out of the dirt, turns over once so the player
      // sees the piece they now own, and goes to the satchel. Unchanged in
      // shape from the procedural version — this is the motion the DOM
      // fly-to and the terracotta chime are already timed against.
      piece.position.y = p * 0.6
      piece.rotation.y = p * 5
      piece.scale.setScalar(Math.max(0.001, 1 - p))
      splinter.scale.setScalar(Math.max(0.001, 1 - p * 1.4))
    },
  })
}

/* --------------------------------------------------------------- factory */

export function createChaosProp(kind: ChaosKind, variant: number): ChaosPropRig {
  switch (kind) {
    case 'vine': return buildVine(variant)
    case 'frond': return buildFrond(variant)
    case 'driftwood': return buildDriftwood(variant)
    case 'morning-glory': return buildMorningGlory(variant)
    case 'basket': return buildBasket(variant)
    case 'stone': return buildStone(variant)
    case 'amphora': return buildAmphora(variant)
  }
}

/* ------------------------------------------------- burst spec (for W-INT) */

/**
 * Recommended emission for the shared `Bursts` system on a chaos clear.
 *
 * The rigs above already throw their own leaf burst — the vine's is two dozen
 * ballistic leaf cards, authored here because it has to match the mesh it comes
 * off. This spec exists so the integrator's `bursts.emit` on `onClear` can stop
 * competing with it: many small dark-to-dry chips of the *right* material, not
 * a dozen big lime confetti flakes in one colour.
 *
 * Colours per kind are the material that just broke — green and dry brown for
 * plants, bleached wood for driftwood, basalt grey for stone, wicker for the
 * basket. Nothing here is gold.
 */
export const CHAOS_BURST: Record<ChaosKind, { count: number; colors: number[]; scale: number }> = {
  vine: { count: 14, colors: [LEAF_DEEP, LEAF_MID, LEAF_DRY], scale: 0.07 },
  frond: { count: 12, colors: [FROND_DRY, FROND_TAN, FROND_BROWN], scale: 0.07 },
  driftwood: { count: 12, colors: [DRIFT_PALE, DRIFT_MID, DRIFT_DARK], scale: 0.06 },
  'morning-glory': { count: 12, colors: [GLORY_GREEN, GLORY_DEEP, LEAF_DRY], scale: 0.06 },
  basket: { count: 12, colors: [WICKER, WICKER_DARK, WICKER_LIT], scale: 0.06 },
  stone: { count: 10, colors: [BASALT, BASALT_LIT, SALT], scale: 0.06 },
  amphora: { count: 8, colors: [TERRACOTTA, TERRACOTTA_IN], scale: 0.06 },
}

/* -------------------------------------------------- bougainvillea spill */

/**
 * The treeline-gap dressing: bougainvillea spilling *out of* the green — the
 * bridge element between wild Maui and the Mediterranean village to come, and
 * the only magenta on screen.
 *
 * The first pass built low round bushes, which on an open lawn read as five
 * cheerful flowerbeds rather than as one thing pouring out of a jungle wall.
 * This is a tall arching mass: woody stems climbing to head height, deep-green
 * foliage packed at the base and thrown wide on the z axis so neighbouring
 * clusters merge into a continuous hedge, and the magenta bracts held only on
 * the upper and outer surface where the dawn actually hits. Restraint is the
 * point — the flare has to be the one splash of that colour in the frame, so
 * the flowers sit on top of a mass that is mostly dark green.
 *
 * Pure set dressing: no rig, no collision, it just flares at the gap and
 * promises.
 */
export function createBougainvilleaSpill(variant: number): THREE.Group {
  const r = rng(839 + variant * 61)
  const g = new THREE.Group()

  // Woody stems: the arch. Leaning out of the treeline, toward -x (the sea).
  // Kept inside the old height envelope — the pocket places these with its own
  // per-cluster scale, and this mass is multiplied by it.
  const nStem = 3 + Math.floor(r() * 2)
  for (let i = 0; i < nStem; i++) {
    const h = 0.55 + r() * 0.45
    const stem = cyl(0.028, 0.055, h, BOUGAIN_STEM, 5)
    stem.position.set((r() - 0.5) * 0.4 - 0.08, h * 0.45, (r() - 0.5) * 0.7)
    stem.rotation.set((r() - 0.5) * 0.5, 0, 0.16 + r() * 0.3)
    g.add(stem)
  }

  // The green mass. Wide on z so clusters knit; deep so the bracts read light.
  const nFoliage = 9 + Math.floor(r() * 4)
  for (let i = 0; i < nFoliage; i++) {
    const a = (i / nFoliage) * Math.PI * 2 + r()
    const spread = 0.3 + r() * 0.45
    const lump = ball(0.2 + r() * 0.16, r() < 0.62 ? VINE_BARK : LEAF_DEEP, 1)
    lump.scale.set(1, 0.8, 1.2)
    lump.position.set(Math.cos(a) * spread * 0.7, 0.25 + r() * 0.6, Math.sin(a) * spread * 1.25)
    g.add(lump)
  }
  // Leaf cards breaking the foliage silhouette so it is not a wall of spheres.
  for (let i = 0; i < 12; i++) {
    const a = r() * Math.PI * 2
    const l = leaf(0.17 + r() * 0.1, 0.11 + r() * 0.06, r() < 0.5 ? LEAF_DEEP : LEAF_MID)
    l.position.set(Math.cos(a) * (0.3 + r() * 0.35), 0.3 + r() * 0.65, Math.sin(a) * (0.4 + r() * 0.5))
    l.rotation.set((r() - 0.5) * 1.2, r() * Math.PI * 2, (r() - 0.5) * 1.2)
    l.castShadow = false
    g.add(l)
  }

  /*
   * Bracts — the spill.
   *
   * This is the only saturated warm colour the spec allows within sight of the
   * treeline, and it is carrying a promise (the village that will one day have
   * this stuff pouring over its walls), so it has to be a MASS: a cascade
   * about two metres across, not a scatter of pink flecks on a green bush,
   * which is what the last pass photographed as.
   *
   * Twice the clusters, half again the bract size, and the whole flare pushed
   * to the seaward face (−x) and DOWN it — a cascade falls, and a flower mass
   * that sits evenly all round the crown reads as a hedge in bloom rather than
   * as something spilling out of a gap. `castShadow` stays off: a papery bract
   * casting a hard shadow onto the mass behind it just muddies the colour.
   */
  const nCluster = 22 + Math.floor(r() * 6)
  for (let i = 0; i < nCluster; i++) {
    // Biased to the seaward half so the flare faces the beach the player wakes
    // on: cos(a) is pushed negative, which is −x.
    const a = Math.PI * 0.5 + (r() - 0.5) * 2.4
    const rad = 0.3 + r() * 0.44
    const cx = -Math.abs(Math.sin(a)) * rad * 0.95 + (r() - 0.5) * 0.2
    // Cascading: the flare starts at the crown and pours down the outer face,
    // so height and outward distance run together.
    const fall = r()
    const cy = 1.1 - fall * fall * 0.72
    const cz = Math.cos(a) * rad * 1.35
    for (let k = 0; k < 3; k++) {
      const bract = leaf(0.2 + r() * 0.09, 0.17 + r() * 0.07, r() < 0.72 ? BOUGAIN : BOUGAIN_DEEP)
      bract.position.set(cx + (r() - 0.5) * 0.16, cy + (r() - 0.5) * 0.14, cz + (r() - 0.5) * 0.16)
      bract.rotation.set((r() - 0.5) * 1.6, r() * Math.PI * 2, (r() - 0.5) * 1.6)
      bract.castShadow = false
      g.add(bract)
    }
  }

  // A few fallen bracts at the feet — the colour echo that says the mass above
  // has been flowering a while. Minor layer: never worth a reflection sample.
  for (let i = 0; i < 4; i++) {
    const petal = leaf(0.1, 0.09, i % 2 === 0 ? BOUGAIN : BOUGAIN_DEEP)
    petal.position.set((r() - 0.5) * 1.5, 0.02, (r() - 0.5) * 1.6)
    petal.rotation.y = r() * Math.PI * 2
    setLayer(petal, MINOR_LAYER)
    g.add(petal)
  }

  g.rotation.y = (r() - 0.5) * 0.8
  g.scale.setScalar(0.92 + r() * 0.3)
  return g
}
