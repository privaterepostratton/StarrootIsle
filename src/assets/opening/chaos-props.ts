import * as THREE from 'three'
import { mat, ball, cyl, rng, MINOR_LAYER, setLayer } from '../style'

/**
 * The clearable chaos set — the stars of the opening's core beat.
 *
 * Seven procedural prop types the player pulls, sweeps, breaks, peels, crushes,
 * pries and picks out of the choked pocket at the treeline gap. Everything is
 * built from the shared style helpers plus flat leaf cards, so the set speaks
 * the same rounded silhouette language as the rest of the world — no GLBs, no
 * textures, nothing that can ship an emissive surprise.
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

/** Fallen palm frond — dead matter, ochre through bleached tan. */
const FROND_RACHIS = 0xa8873f
const FROND_DRY = 0xd2ae5f
const FROND_TAN = 0xe6cd96
const FROND_BROWN = 0xa8834a

/** Sun-bleached driftwood: grey-tan, the lightest wood on the beach. */
const DRIFT_PALE = 0xd6cdb8
const DRIFT_MID = 0xb2a78e
const DRIFT_DARK = 0x877d6a

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
/** Shading floors (see `shadedFloor`): the darkest value, never a void. */
const BASALT_FLOOR = 0x1a1714
const VINE_FLOOR = 0x161c12

/** The amphora shard — the opening's only terracotta (spec #C4693B). */
const TERRACOTTA = 0xc4693b
const TERRACOTTA_IN = 0xd9906a
const TERRACOTTA_BAND = 0x8f4a2c

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

/** Seconds the vine's snap runs — long enough for its leaf burst to fly. */
const VINE_CLEAR = 1.0
/** Gravity on burst leaves, in units/s². Light: they hang, then settle. */
const LEAF_GRAVITY = 4.4

/** One leaf in the snap burst: ballistic, spinning, and pure in `p`. */
interface Flake {
  mesh: THREE.Mesh
  base: THREE.Vector3
  vel: THREE.Vector3
  spin: THREE.Vector3
  scale: THREE.Vector3
  /** Seconds after the snap before this one launches. */
  delay: number
  /** False for the extra shrapnel, which is hidden until the snap. */
  standing: boolean
}

/**
 * A tangle of near-black woody loops with leaves caught in it — three authored
 * variants. Strain stretches the whole knot upward like pulled elastic.
 *
 * The clear is the set piece: a last over-stretch, the loops collapse, and
 * every leaf in the tangle *plus* a fistful of hidden shrapnel bursts out as
 * small tapered cards on real ballistic arcs with per-leaf spin. The first pass
 * fired a handful of large flat confetti squares upward; this fires two dozen
 * leaf-shaped chips in jungle green with dry-brown variation, which is what a
 * vine full of dead matter actually sheds when it lets go.
 */
function buildVine(variant: number): ChaosPropRig {
  const r = rng(101 + variant * 37)
  const root = new THREE.Group()
  const tangle = new THREE.Group()
  const skirt = litterSkirt(r, 7, 0.45, 0.95)
  root.add(tangle, skirt)

  // The knot. Two populations, because a pile of same-sized closed rings reads
  // as a stack of tyres: tight coils for the mass, plus long shallow arcs that
  // sweep out past them and tie the tangle to the ground.
  const nCoil = 5 + Math.floor(r() * 3)
  for (let i = 0; i < nCoil; i++) {
    const coil = shadedFloor(
      new THREE.TorusGeometry(0.2 + r() * 0.16, 0.055 + r() * 0.025, 6, 10, Math.PI * (1.1 + r() * 0.85)),
      r() < 0.6 ? VINE_BARK : VINE_BARK_LIT,
      VINE_FLOOR,
    )
    coil.position.set((r() - 0.5) * 0.45, 0.22 + r() * 0.5, (r() - 0.5) * 0.45)
    coil.rotation.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI)
    tangle.add(coil)
  }
  const nArc = 3 + Math.floor(r() * 2)
  for (let i = 0; i < nArc; i++) {
    const arc = shadedFloor(
      new THREE.TorusGeometry(0.5 + r() * 0.28, 0.038 + r() * 0.018, 5, 12, Math.PI * (0.45 + r() * 0.5)),
      i % 2 === 0 ? VINE_BARK : VINE_BARK_LIT,
      VINE_FLOOR,
    )
    arc.position.set((r() - 0.5) * 0.3, 0.1 + r() * 0.3, (r() - 0.5) * 0.3)
    arc.rotation.set(1.1 + (r() - 0.5) * 1.6, r() * Math.PI * 2, (r() - 0.5) * 1.2)
    tangle.add(arc)
  }
  // Tendrils whipping out of the knot: they break the round mass and read as
  // something still growing, so the tangle is alive rather than a discarded rope.
  for (let i = 0; i < 4; i++) {
    const tendril = cyl(0.012, 0.03, 0.55 + r() * 0.5, i % 2 === 0 ? VINE_BARK : VINE_BARK_LIT, 5)
    tendril.position.set((r() - 0.5) * 0.6, 0.5 + r() * 0.45, (r() - 0.5) * 0.6)
    tendril.rotation.set((r() - 0.5) * 1.2, r() * Math.PI, (r() - 0.5) * 1.2)
    tangle.add(tendril)
  }

  const flakes: Flake[] = []
  const addFlake = (mesh: THREE.Mesh, standing: boolean) => {
    const a = Math.atan2(mesh.position.z, mesh.position.x) + (r() - 0.5) * 0.8
    const speed = 1.1 + r() * 1.7
    flakes.push({
      mesh,
      base: mesh.position.clone(),
      vel: new THREE.Vector3(Math.cos(a) * speed, 1.5 + r() * 1.9, Math.sin(a) * speed),
      spin: new THREE.Vector3((r() - 0.5) * 16, (r() - 0.5) * 20, (r() - 0.5) * 16),
      scale: mesh.scale.clone(),
      delay: standing ? r() * 0.05 : 0.04 + r() * 0.1,
      standing,
    })
  }

  // Leaves living in the tangle. Two thirds green, a third dead — the tangle
  // has been strangling itself for a while. They are pushed OUT past the coils
  // and tipped up toward the light, because the foliage has to be what forms
  // the outer silhouette: the pale leaf edge against the dark knot is the whole
  // reason the prop reads from across the clearing.
  const nLeaf = 16 + Math.floor(r() * 5)
  for (let i = 0; i < nLeaf; i++) {
    const a = r() * Math.PI * 2
    const d = 0.3 + r() * 0.48
    const tone = r()
    const l = leaf(
      0.3 + r() * 0.2,
      0.19 + r() * 0.12,
      tone < 0.36 ? LEAF_PALE : tone < 0.68 ? LEAF_MID : tone < 0.86 ? LEAF_DEEP : LEAF_DRY,
    )
    l.position.set(Math.cos(a) * d, 0.16 + r() * 0.85, Math.sin(a) * d)
    l.rotation.set(-0.5 - r() * 0.7, a + (r() - 0.5) * 0.9, (r() - 0.5) * 1.5)
    tangle.add(l)
    addFlake(l, true)
  }
  // Hidden shrapnel — invisible at rest, born at the snap so the burst is
  // denser than the tangle could plausibly hold.
  for (let i = 0; i < 11; i++) {
    const a = r() * Math.PI * 2
    const tone = r()
    const l = leaf(
      0.17 + r() * 0.13,
      0.11 + r() * 0.08,
      tone < 0.3 ? LEAF_PALE : tone < 0.58 ? LEAF_MID : tone < 0.8 ? LEAF_DEEP : LEAF_DEAD,
    )
    l.position.set(Math.cos(a) * 0.16, 0.32 + r() * 0.45, Math.sin(a) * 0.16)
    l.visible = false
    l.castShadow = false
    tangle.add(l)
    addFlake(l, false)
  }

  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: VINE_CLEAR,
    idle(elapsed) {
      tangle.rotation.y = Math.sin(elapsed * 0.7 + variant * 2.1) * 0.03
    },
    strain(s, elapsed) {
      tangle.scale.set(1 - 0.13 * s, 1 + 0.3 * s, 1 - 0.13 * s)
      tangle.rotation.z = Math.sin(elapsed * 26) * 0.05 * s
      tangle.position.y = 0.06 * s
      for (const f of flakes) {
        if (!f.standing) continue
        f.mesh.position.y = f.base.y + 0.1 * s
        f.mesh.rotation.z = Math.sin(elapsed * 30 + f.base.x * 9) * 0.25 * s
      }
    },
    clear(p) {
      // The knot's own collapse happens in the first third; the burst owns the
      // rest of the window.
      const knot = Math.min(1, p / 0.34)
      if (knot < 0.5) {
        tangle.scale.set(0.86, 1.3 + knot * 0.5, 0.86)
      } else {
        const q = (knot - 0.5) / 0.5
        const s = Math.max(0.001, 1 - q)
        tangle.scale.set(s, s * 0.45, s)
      }
      tangle.position.y = 0.06 * (1 - knot)
      skirt.scale.setScalar(Math.max(0.001, 1 - knot))

      const now = p * VINE_CLEAR
      for (const f of flakes) {
        const t = now - f.delay
        if (t <= 0) {
          f.mesh.visible = f.standing
          continue
        }
        f.mesh.visible = true
        f.mesh.position.set(
          f.base.x + f.vel.x * t,
          f.base.y + f.vel.y * t - 0.5 * LEAF_GRAVITY * t * t,
          f.base.z + f.vel.z * t,
        )
        f.mesh.rotation.set(f.spin.x * t, f.spin.y * t, f.spin.z * t)
        // Hold full size for most of the flight, then shrink out fast, so the
        // burst dies as a fade rather than as a swarm shrinking in place.
        const tail = Math.max(0, (p - 0.66) / 0.34)
        f.mesh.scale.copy(f.scale).multiplyScalar(Math.max(0.001, 1 - tail * tail))
      }
    },
  })
}

/* -------------------------------------------------------------- 2. frond */

/**
 * A fallen palm frond — a big dry blade, nearly two metres of it, arching where
 * it fell. The quickest clear in the set: a short drag of resistance, then the
 * whole thing sweeps aside and is gone.
 *
 * Dead matter, so it reads ochre through bleached tan: the brightest value in
 * the pocket and the one that separates most violently from the grass. The
 * leaflets are angled up off the rachis rather than lying flat, which gives the
 * frond a ridge line and stops it reading as a painted stripe on the lawn.
 */
function buildFrond(variant: number): ChaosPropRig {
  const r = rng(211 + variant * 53)
  const root = new THREE.Group()
  const blade = new THREE.Group()
  const skirt = litterSkirt(r, 5, 0.5, 1.1)
  root.add(blade, skirt)

  // The rachis, built in three segments so it can arch.
  let x = -0.9
  let y = 0.05
  for (let i = 0; i < 3; i++) {
    const seg = cyl(0.022, 0.036, 0.66, FROND_RACHIS, 6)
    seg.rotation.z = Math.PI / 2
    seg.position.set(x + 0.33, y + i * 0.035, 0)
    blade.add(seg)
    x += 0.62
  }

  const nLeaflet = 15
  for (let i = 0; i < nLeaflet; i++) {
    const t = i / (nLeaflet - 1)
    const along = -0.86 + t * 1.75
    const side = i % 2 === 0 ? 1 : -1
    // Leaflets shorten toward the tip, the way a real frond tapers.
    const len = (0.62 - t * 0.26) * (0.85 + r() * 0.3)
    const tone = r()
    const l = leaf(len, 0.17 + r() * 0.07, tone < 0.4 ? FROND_TAN : tone < 0.8 ? FROND_DRY : FROND_BROWN)
    // Offset outward by half its length: a leaflet grows *from* the rachis. The
    // card straddles its own origin, so without this every leaflet sticks out
    // both sides and the frond collapses into a stripe.
    l.position.set(along, 0.07 + t * 0.09 + r() * 0.03, side * len * 0.46)
    // Swept back toward the tip and lifted off the ground into a shallow vee.
    l.rotation.set(side * (0.5 + r() * 0.3), -side * (0.3 + r() * 0.2), 0)
    blade.add(l)
  }
  // A couple of loose leaflets that have already torn off.
  for (let i = 0; i < 3; i++) {
    const l = leaf(0.42 + r() * 0.22, 0.16, i % 2 === 0 ? FROND_BROWN : FROND_DRY)
    l.position.set(-0.7 + r() * 1.7, 0.025, (r() - 0.5) * 0.9)
    l.rotation.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.4)
    l.castShadow = false
    blade.add(l)
  }

  root.rotation.y = r() * Math.PI * 2
  blade.rotation.y = (r() - 0.5) * 0.5
  const baseYaw = blade.rotation.y
  const sweepDir = new THREE.Vector3(Math.sin(r() * Math.PI * 2), 0, Math.cos(r() * Math.PI * 2))
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      blade.rotation.y = baseYaw + s * 0.4 + Math.sin(elapsed * 24) * 0.04 * s
      blade.rotation.x = s * 0.14
      blade.position.y = 0.03 * s
      skirt.rotation.y = s * 0.1
    },
    clear(p) {
      blade.rotation.y = baseYaw + 0.4 + p * 2.1
      blade.position.copy(sweepDir).multiplyScalar(p * 1.05)
      blade.position.y = 0.03 + Math.sin(p * Math.PI) * 0.22
      blade.scale.setScalar(Math.max(0.001, 1 - p))
      skirt.scale.setScalar(Math.max(0.001, 1 - p))
    },
  })
}

/* ---------------------------------------------------------- 3. driftwood */

/**
 * A silvered branch, two metres of it, thick at one end with a snag of side
 * twigs and a split already opening at the middle. Bleached grey-tan: the
 * beach's memory of a tree, and the second-lightest thing in the pocket.
 *
 * The strain flexes the two halves about the split; the clear cracks it in two
 * and the pieces arc apart — the wood ×2 payout made visible.
 */
function buildDriftwood(variant: number): ChaosPropRig {
  const r = rng(307 + variant * 41)
  const root = new THREE.Group()
  const skirt = litterSkirt(r, 4, 0.5, 1.0)
  root.add(skirt)

  const halfA = new THREE.Group()
  const logA = cyl(0.1, 0.135, 1.15, DRIFT_PALE, 7)
  logA.rotation.z = Math.PI / 2
  logA.position.set(-0.56, 0.13, 0)
  halfA.add(logA)
  // Root flare at the heavy end reads as *broken off a tree*, not sawn.
  const flare = ball(0.17, DRIFT_MID, 0)
  flare.scale.set(0.9, 0.85, 1.05)
  flare.position.set(-1.1, 0.15, 0.02)
  halfA.add(flare)
  for (let i = 0; i < 2; i++) {
    const stub = cyl(0.028, 0.055, 0.38 + r() * 0.2, DRIFT_DARK, 5)
    stub.position.set(-0.75 + i * 0.3, 0.3, 0.04 - i * 0.12)
    stub.rotation.set(0.5 + r() * 0.4, r() * Math.PI, 0.6 + r() * 0.5)
    halfA.add(stub)
  }

  const halfB = new THREE.Group()
  const logB = cyl(0.062, 0.095, 0.9, DRIFT_PALE, 7)
  logB.rotation.z = Math.PI / 2
  logB.rotation.y = 0.16
  logB.position.set(0.47, 0.11, 0.04)
  halfB.add(logB)
  const knot = ball(0.07, DRIFT_DARK, 0)
  knot.position.set(0.72, 0.13, 0.06)
  halfB.add(knot)
  const twig = cyl(0.018, 0.03, 0.34, DRIFT_MID, 4)
  twig.position.set(0.86, 0.2, 0.02)
  twig.rotation.set(0.3, 0.4, 1.0)
  halfB.add(twig)

  root.add(halfA, halfB)
  root.rotation.y = r() * Math.PI * 2
  root.rotation.z = (r() - 0.5) * 0.12
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      const quiver = Math.sin(elapsed * 22) * 0.04 * s
      halfA.rotation.z = 0.13 * s + quiver
      halfB.rotation.z = -0.13 * s - quiver
      root.position.y = 0.02 * s
    },
    clear(p) {
      halfA.rotation.z = 0.13 + p * 0.9
      halfB.rotation.z = -0.13 - p * 0.9
      halfA.position.set(-p * 0.45, Math.sin(p * Math.PI) * 0.32, 0)
      halfB.position.set(p * 0.45, Math.sin(p * Math.PI) * 0.34, 0)
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

/**
 * A broken woven basket, tipped on its side with the weave sprung open.
 *
 * Now actually woven: vertical staves running up through three courses of
 * horizontal weave, several of them snapped and splayed out where something
 * stood on it. That silhouette — a torn ring of sticks — is the first hint on
 * screen that people were here before, so it earns the extra geometry.
 *
 * (The spiral-shell surprise inside is the pocket's drop, not a mesh of this
 * rig — the reveal lands with the payout arc, where the eye already is.)
 */
function buildBasket(variant: number): ChaosPropRig {
  const r = rng(523 + variant * 31)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const R = 0.4
  const base = cyl(R * 0.85, R * 0.95, 0.07, WICKER_DARK, 11)
  base.position.y = 0.035
  body.add(base)
  // Packed dead weave inside. Without it the basket is a birdcage: the eye
  // looks straight through the staves at the grass and never resolves a volume.
  const fill = ball(R * 0.78, WICKER_DARK, 0)
  fill.scale.set(1, 0.55, 1)
  fill.position.y = 0.19
  body.add(fill)

  // Staves: the vertical ribs. Two are missing and three lean out, broken.
  const nStave = 13
  for (let i = 0; i < nStave; i++) {
    if (i === 4 || i === 9) continue
    const a = (i / nStave) * Math.PI * 2
    const broken = i === 3 || i === 10 || i === 11
    const h = broken ? 0.34 + r() * 0.14 : 0.52
    const stave = cyl(0.017, 0.021, h, i % 3 === 0 ? WICKER_DARK : WICKER, 4)
    stave.position.set(Math.cos(a) * R, h / 2 + 0.03, Math.sin(a) * R)
    stave.rotation.set(broken ? Math.cos(a) * 0.75 : 0, 0, broken ? -Math.sin(a) * 0.75 : 0)
    if (!broken) {
      stave.rotation.x = Math.cos(a) * 0.12
      stave.rotation.z = -Math.sin(a) * 0.12
    }
    body.add(stave)
  }
  // Weave courses, each an open arc so the basket reads as burst, not intact.
  const courses = [0.13, 0.28, 0.44]
  for (let i = 0; i < courses.length; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R + i * 0.012, 0.032, 5, 14, Math.PI * (1.35 + r() * 0.35)),
      mat(i === 1 ? WICKER_LIT : WICKER),
    )
    ring.castShadow = true
    ring.receiveShadow = true
    ring.rotation.x = Math.PI / 2
    ring.rotation.z = r() * Math.PI * 2
    ring.position.y = courses[i]
    body.add(ring)
  }

  // Loose weave ends that pop out when it is crushed.
  const sticks: Flung[] = []
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2
    const stick = cyl(0.013, 0.018, 0.32 + r() * 0.2, WICKER_DARK, 4)
    stick.position.set(Math.cos(a) * R * 0.8, 0.34 + r() * 0.16, Math.sin(a) * R * 0.8)
    stick.rotation.set((r() - 0.5) * 1.3, 0, 0.5 + r() * 0.7)
    body.add(stick)
    sticks.push({
      mesh: stick,
      basePos: stick.position.clone(),
      baseScale: stick.scale.clone(),
      dir: new THREE.Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize(),
    })
  }

  root.add(litterSkirt(r, 4, 0.5, 0.95))
  root.rotation.z = 0.26
  root.rotation.y = r() * Math.PI * 2
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      body.scale.set(1 + 0.2 * s, 1 - 0.42 * s, 1 + 0.2 * s)
      body.rotation.y = Math.sin(elapsed * 24) * 0.05 * s
    },
    clear(p) {
      body.scale.set(1.2 + p * 0.25, Math.max(0.05, 0.58 - p * 0.5), 1.2 + p * 0.25)
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.55) / 0.45))
      body.scale.multiplyScalar(s)
      for (const f of sticks) fling(f, p, 0.8, 0.3)
    },
  })
}

/* --------------------------------------------------------------- 6. stone */

/**
 * A half-sunk basalt stone: near-black, hard-faceted, crusted white with dried
 * salt on its weather side, with a scatter of chips where it has spalled.
 *
 * This is the darkest object in the game's opening and it is deliberately the
 * least round thing in it — flat-shaded facets and a couple of shoulders, so it
 * reads as volcanic rock next to a world made of spheres. The salt crust is the
 * only pure white on screen and does all the work of keeping it from becoming a
 * hole in the grass.
 *
 * The longest hold in the set — the shovel pry rocks it back and forth, lifting
 * a little more each moment, and the clear pops it free in an arc.
 */
function buildStone(variant: number): ChaosPropRig {
  const r = rng(631 + variant * 43)
  const root = new THREE.Group()

  const boulder = shadedFloor(new THREE.IcosahedronGeometry(0.4 + r() * 0.09, 0), BASALT, BASALT_FLOOR)
  boulder.scale.set(1, 0.66, 0.86)
  boulder.rotation.set(r() * 0.6, r() * Math.PI * 2, r() * 0.6)
  boulder.position.y = 0.09
  root.add(boulder)

  // A second, smaller mass fused to the first: two shoulders read as rock,
  // one reads as a ball.
  const shoulder = shadedFloor(new THREE.IcosahedronGeometry(0.22 + r() * 0.06, 0), BASALT_LIT, BASALT_FLOOR)
  shoulder.scale.set(1, 0.7, 0.9)
  shoulder.rotation.set(r(), r() * Math.PI, r())
  shoulder.position.set(0.26, 0.12, -0.16)
  root.add(shoulder)

  // Spalled chips at the foot.
  for (let i = 0; i < 3; i++) {
    const a = r() * Math.PI * 2
    const chip = shadedFloor(
      new THREE.IcosahedronGeometry(0.06 + r() * 0.045, 0),
      i % 2 === 0 ? BASALT : BASALT_LIT,
      BASALT_FLOOR,
    )
    chip.scale.set(1.1, 0.5, 0.9)
    chip.position.set(Math.cos(a) * (0.42 + r() * 0.2), 0.03, Math.sin(a) * (0.42 + r() * 0.2))
    chip.rotation.y = a
    root.add(chip)
  }

  // Salt crust on the top and the weather side — flat patches, not blobs.
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2
    const crust = ball(0.07 + r() * 0.05, SALT, 0)
    crust.scale.set(1.25, 0.16, 1)
    crust.position.set(Math.cos(a) * 0.2, 0.22 + r() * 0.06, Math.sin(a) * 0.16)
    crust.rotation.set((r() - 0.5) * 0.3, a, (r() - 0.5) * 0.3)
    root.add(crust)
  }

  const baseY = root.position.y
  return assembleRig(root, {
    time: 0.5,
    strain(s, elapsed) {
      root.rotation.x = Math.sin(elapsed * 19) * 0.07 * s
      root.rotation.z = Math.cos(elapsed * 16) * 0.06 * s
      root.position.y = baseY + 0.13 * s
    },
    clear(p) {
      root.position.y = baseY + 0.13 + Math.sin(Math.min(1, p * 1.1) * Math.PI) * 0.42 + p * 0.05
      root.rotation.z = p * 1.1
      const s = Math.max(0.001, 1 - Math.max(0, (p - 0.45) / 0.55))
      root.scale.setScalar(s)
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
  const r = rng(733 + variant * 17)
  const root = new THREE.Group()
  const piece = new THREE.Group()
  root.add(piece)

  // A patch of pot wall. Double-sided because both faces of a shard show; the
  // inner face gets its own paler mesh just inside it.
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 10, 7, 0, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.52),
    new THREE.MeshLambertMaterial({ color: TERRACOTTA, side: THREE.DoubleSide }),
  )
  shell.castShadow = true
  shell.receiveShadow = true
  piece.add(shell)

  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(0.355, 10, 7, 0.02, Math.PI * 0.76, Math.PI * 0.22, Math.PI * 0.48),
    new THREE.MeshLambertMaterial({ color: TERRACOTTA_IN, side: THREE.DoubleSide }),
  )
  piece.add(inner)

  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.362, 0.019, 5, 14, Math.PI * 0.74),
    new THREE.MeshLambertMaterial({ color: TERRACOTTA_BAND, side: THREE.DoubleSide }),
  )
  band.rotation.x = Math.PI / 2
  band.rotation.z = 0.05
  band.position.y = -0.07
  piece.add(band)

  // Lying open-side-up, slightly sunk, like it washed in years ago.
  piece.rotation.set(2.4 + (r() - 0.5) * 0.3, r() * Math.PI * 2, 0.2)
  piece.position.y = -0.04

  // A splinter that broke off the shard, left in the dirt beside it.
  const splinter = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 7, 5, 0, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.4),
    new THREE.MeshLambertMaterial({ color: TERRACOTTA, side: THREE.DoubleSide }),
  )
  splinter.rotation.set(2.1, r() * Math.PI * 2, 0.4)
  splinter.position.set(0.38 + r() * 0.15, 0.01, -0.2 + r() * 0.3)
  root.add(splinter)

  const baseYaw = piece.rotation.y
  const baseY = piece.position.y
  return assembleRig(root, {
    time: 0.5,
    strain() {
      /* Tap-collect: the shard never strains. */
    },
    clear(p) {
      piece.position.y = baseY + p * 0.6
      piece.rotation.y = baseYaw + p * 5
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

  // Bracts: upper and outer only. Papery little cards, clustered in threes the
  // way bougainvillea actually flowers.
  const nCluster = 11 + Math.floor(r() * 4)
  for (let i = 0; i < nCluster; i++) {
    const a = r() * Math.PI * 2
    const rad = 0.3 + r() * 0.36
    const cx = Math.cos(a) * rad * 0.85
    // Weighted to the crown: bracts sit where the dawn reaches, and a flare
    // that starts halfway down the mass stops being a flare.
    const cy = 0.58 + r() * r() * 0.62
    const cz = Math.sin(a) * rad * 1.3
    for (let k = 0; k < 3; k++) {
      const bract = leaf(0.14 + r() * 0.06, 0.125 + r() * 0.05, r() < 0.7 ? BOUGAIN : BOUGAIN_DEEP)
      bract.position.set(cx + (r() - 0.5) * 0.13, cy + (r() - 0.5) * 0.11, cz + (r() - 0.5) * 0.13)
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
