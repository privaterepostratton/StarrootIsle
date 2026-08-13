import * as THREE from 'three'
import { groundHeight } from './terrain'
import { containingSlot, exitWaypoint, routeToPoint } from './village-router'

/**
 * A trail of chevrons laid on the ground, flowing toward somewhere the player
 * needs to go. Gold in the village, and any colour a caller asks for — the isle
 * opening runs an ivory one, because gold there means luck and nothing else.
 *
 * Why a path and not a marker: the "!" over a building answers *what*, and only
 * once you can already see the building. A full barn stops every harvest on the
 * farm and the fix is at a stall the player may never have walked to, on the far
 * side of the village behind their own fences. What they need is a direction
 * they can follow from where they are standing, and a line of arrows on the
 * ground is the one signpost that works from any camera angle without covering
 * the world.
 *
 * The route is not a straight line. It is walked out through the village
 * waypoint graph, so it goes out of your gate and up the lane rather than
 * pointing hopefully through a fence — a trail that leads into scenery teaches
 * the player to stop trusting it.
 *
 * **Direct mode** (the isle opening) is the same trail with the graph taken
 * out. Beach and jungle floor have no lanes and no fences, so there is nothing
 * for a router to route around — and asking it anyway is actively wrong there,
 * because the opening's own destinations sit *inside* the player's fenced slot
 * (the farm pad is PLAYER_SLOT) and the village solver's first move for anyone
 * standing in a slot is "leave by the gate". A player being led four paces to
 * the seed crate would be sent out of a fence that has not been built yet. So
 * direct mode lays the polyline itself, optionally bent through one caller-
 * supplied waypoint, which is how the trail into the clearing goes through the
 * treeline doorway rather than through eight units of foliage.
 *
 * The graph solver carries a rail for the same hazard (see `solve`): asked for
 * a route it cannot walk, it hands back a straight line rather than nothing, so
 * a caller who forgets `direct` gets a trail that points the right way instead
 * of a trail that silently is not there.
 */

/** Distance between chevrons along the path. Tracks SIZE — they must not touch. */
const SPACING = 1.05
/** How far along the route the trail is drawn. Enough to commit to a direction. */
const LENGTH = 16
/** How far ahead of the player the trail starts, so it is not under their feet. */
const LEAD = 1.1
/**
 * The same, in direct mode.
 *
 * The opening's objectives are close — the seed crate is a handful of paces
 * from where you wake — and a trail that only starts 1.1 units out spends most
 * of a short route in its own near fade. Shortening the lead keeps arrows on
 * the ground for the last few steps, which is the stretch where a player who
 * has not yet worked out the controls is looking hardest for one.
 */
const LEAD_DIRECT = 0.75
/**
 * How far the near end takes to fade up, in units, and the same in direct mode.
 *
 * The ramp is what hides the wrap, so it cannot go away — but it is measured
 * from the lead, and a 1.6-unit ramp on top of a 0.75-unit lead means nothing is
 * fully opaque until 2.35 units out. That is most of a four-pace route to the
 * seed crate, which is the one route in the game whose whole job is to be
 * followed by somebody who has not yet worked out that arrows are followable.
 */
const NEAR_FADE = 1.6
const NEAR_FADE_DIRECT = 1.0
/** Arrows per second flowing along it. */
const FLOW = 1.6
/** Above the lane and scatter decals — see the Y ladder in world.ts. */
const Y = 0.075

const COUNT = Math.ceil(LENGTH / SPACING)

/** How big one mark on the ground is, in world units. */
const SIZE = 1.25

/**
 * The trail's colour everywhere outside the opening, and the default.
 *
 * Named so the palette table below can recognise it and hand back the hand-
 * tuned gold sticker byte for byte, rather than a derived approximation of it.
 */
export const GUIDE_GOLD = 0xffd062

/** The three bands of the sticker, plus what sits behind it. */
interface ChevronPalette {
  /** The bright face — this is "the colour" of the trail. */
  face: string
  /** The band inside the keyline, reading as a shaded edge. */
  shade: string
  /** The outermost stroke: the sticker's die-cut line. */
  keyline: string
  /** Soft dark halo behind the whole mark, 0 for none. See CONTACT_* below. */
  halo: number
  /** Width of the keyline stroke, as a fraction of the texture. */
  keylineWidth: number
  /** The arrow, scaled about the middle of its texture — see `paletteFor`. */
  scale: number
  /**
   * How far past white the unlit material is pushed. See the material comment
   * in the constructor — this is that boost, made per-palette because it is a
   * function of how bright the face already is.
   */
  boost: number
}

/**
 * Gold, exactly as it has always been drawn: white keyline, brown shade band,
 * bright face, no halo.
 */
const GOLD_PALETTE: ChevronPalette = {
  face: '#ffd062',
  shade: '#a2670f',
  keyline: '#fffdf2',
  halo: 0,
  keylineWidth: 0.15,
  scale: 1,
  boost: 1.45,
}

/** What the derived palettes darken toward — a warm near-black, not a grey. */
const INK = [0x24, 0x1a, 0x0e]

/** How much ink is in the keyline and in the shade band, as a mix fraction. */
const KEYLINE_INK = 0.86
const SHADE_INK = 0.62

/** Blur radius of the contact shadow, in canvas pixels, and its opacity. */
const CONTACT_BLUR = 10
const CONTACT_ALPHA = 0.62

/**
 * The largest lift a derived palette is allowed, and where the face is aimed.
 *
 * Gold's 1.45 is hand-tuned for a saturated mid-tone with headroom to burn. A
 * near-white face has none: ivory's brightest channel is already at 0.86 of
 * full in linear terms, so pushing it as hard as gold clips it to flat white —
 * which is exactly what the first attempt shipped, and it costs the mark both
 * its warmth and the shade band that makes it read as a sticker rather than a
 * smear. Photographed side by side on sand, the clipped version is a white
 * blaze and the lifted one is the ivory the spec actually names.
 *
 * So the lift is computed from the colour rather than chosen: push until the
 * brightest channel is just short of clipping, and never past gold's ceiling.
 */
const LIFT_CEILING = 1.45
const LIFT_TARGET = 0.985

/** sRGB byte → linear, matching three's own `setHex` conversion. */
function toLinear(byte: number) {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function boostFor(hex: number) {
  const peak = Math.max(
    toLinear((hex >> 16) & 255),
    toLinear((hex >> 8) & 255),
    toLinear(hex & 255),
    1e-3,
  )
  return Math.min(LIFT_CEILING, LIFT_TARGET / peak)
}

function mixToInk(hex: number, t: number) {
  const parts = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((c, i) =>
    Math.round(c * (1 - t) + INK[i] * t),
  )
  return `#${parts.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * A sticker palette for any colour the caller asks for.
 *
 * Gold is returned verbatim, so nothing about the village's trail can drift
 * when this file is edited for the opening's sake. Everything else is derived,
 * and the derivation deliberately inverts gold's own construction: gold is a
 * saturated mid-tone that needs a *white* keyline to lift it off dark grass,
 * while the opening's ivory is already nearly white and is being laid on ivory
 * sand — the only thing that can separate it there is ink. So a derived
 * palette runs dark-to-light from the outside in, and carries a soft contact
 * shadow underneath as well, because a hard line alone still disappears when
 * the sun is directly on the beach.
 */
function paletteFor(hex: number): ChevronPalette {
  if (hex === GUIDE_GOLD) return GOLD_PALETTE
  return {
    face: mixToInk(hex, 0),
    shade: mixToInk(hex, SHADE_INK),
    keyline: mixToInk(hex, KEYLINE_INK),
    halo: CONTACT_ALPHA,
    keylineWidth: GOLD_PALETTE.keylineWidth,
    scale: GOLD_PALETTE.scale,
    boost: boostFor(hex),
  }
}

/**
 * The arrow, painted once into a canvas and worn by every chevron in the trail.
 *
 * Painted rather than built out of geometry, and that is a deliberate second
 * attempt. The look wanted here — a chunky arrow with a white keyline, a dark
 * inner edge and a bright face, corners rounded like a sticker — is three
 * nested shapes, and three nested shapes on a *fading* mesh blend into each
 * other: at 40% alpha the face reaches the screen as a third gold, a third
 * brown and a third white, which is exactly the pale mush that produced. A
 * pre-composited texture has its layers resolved before the fade ever sees
 * them, so fading changes how much of the arrow you can see and never what
 * colour it is. Rounded joins come free here and are fiddly in a triangulator.
 *
 * The contact shadow is baked in here for the same reason. A second, darker
 * quad under every arrow would double the mesh count and — being a separate
 * transparent surface at the same height — would flicker against its own arrow
 * wherever the two sort differently. Painted into the same texture it is one
 * surface, it fades with the arrow it belongs to, and it costs nothing.
 */
function buildChevronTexture(palette: ChevronPalette) {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!

  // The outline, in canvas pixels, tip toward the top of the image. Inset from
  // the edges by the width of the fattest stroke, or the keyline clips.
  const outline: [number, number][] = [
    [0.12, 0.84],
    [0.5, 0.38],
    [0.88, 0.84],
    [0.88, 0.56],
    [0.5, 0.1],
    [0.12, 0.56],
  ]
  const path = new Path2D()
  outline.forEach(([x, y], i) => (i === 0 ? path.moveTo(x * S, y * S) : path.lineTo(x * S, y * S)))
  path.closePath()

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  /*
   * The contact shadow, before anything else so the sticker lands on top of it.
   *
   * It is cast from the *stroked* path rather than from the fill: the keyline
   * below straddles the outline and so extends half its own width beyond it,
   * and a shadow spread only from the fill edge ends up entirely hidden under
   * that. Stroking at the keyline's width puts the shadow's source where the
   * finished mark's silhouette actually is. Two passes because a single canvas
   * shadow at this radius is far too thin to read against lit sand.
   */
  if (palette.halo > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${palette.halo})`
    ctx.shadowBlur = CONTACT_BLUR
    // The caster itself must not paint: it is offset right out of the canvas
    // and only its shadow, which is offset back, lands on the bitmap.
    ctx.shadowOffsetX = S
    ctx.translate(-S, 0)
    ctx.strokeStyle = '#000'
    ctx.lineWidth = S * 0.15
    ctx.stroke(path)
    ctx.stroke(path)
    ctx.fillStyle = '#000'
    ctx.fill(path)
    ctx.restore()
  }

  /*
   * Widest stroke first, then narrower, then the fill.
   *
   * Each stroke straddles the outline, so the next one over-paints its inner
   * half and the fill over-paints what is left inside: what survives is a
   * keyline, a shade band and a clean face, from one path drawn three times.
   * Round joins are what make the corners chunky rather than mitred to points.
   */
  ctx.strokeStyle = palette.keyline
  ctx.lineWidth = S * 0.15
  ctx.stroke(path)
  ctx.strokeStyle = palette.shade
  ctx.lineWidth = S * 0.08
  ctx.stroke(path)
  ctx.fillStyle = palette.face
  ctx.fill(path)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** One texture per colour asked for, built on first use and kept. */
const textures = new Map<number, THREE.Texture>()

function chevronTexture(hex: number) {
  let texture = textures.get(hex)
  if (!texture) {
    texture = buildChevronTexture(paletteFor(hex))
    textures.set(hex, texture)
  }
  return texture
}

/**
 * The quad it is painted on.
 *
 * Lay it flat, then spin it half a turn. Both steps are needed and neither is
 * optional. `rotateX(-90°)` is the one that leaves the face normal pointing
 * *up* — the opposite sign lays it just as flat but face-down, and a FrontSide
 * material then draws nothing at all from a camera above it. That rotation also
 * carries the texture's top edge round to -Z, so every arrow pointed back the
 * way the player had come; the half turn about Y puts the tip on +Z without
 * touching the normal, which is what makes a mesh's `rotation.y` simply its
 * heading.
 */
const CHEVRON = (() => {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE)
  geo.rotateX(-Math.PI / 2)
  geo.rotateY(Math.PI)
  return geo
})()

const scratch = new THREE.Vector3()

/**
 * The route, laid by hand: player → (waypoint) → destination.
 *
 * No graph, no fences, no gates — see the "direct mode" paragraph at the top.
 * The polyline is left coarse on purpose: every arrow looks its own ground
 * height up where it lands (see `updateLane`), so subdividing the legs would
 * buy nothing but garbage. What the legs do have to be is *in the right order*
 * and never doubled back on, which is what `viaPending` is for.
 *
 * Heights are all left at zero. The route is only ever read for its x/z, and
 * feeding it real heights would make `total` — and therefore where the trail
 * fades out — depend on how steep the beach is.
 */
function directRoute(
  from: THREE.Vector3,
  target: THREE.Vector3,
  via: THREE.Vector3 | null,
): THREE.Vector3[] {
  const pts = [new THREE.Vector3(from.x, 0, from.z)]
  if (via && viaPending(from, via, target)) pts.push(new THREE.Vector3(via.x, 0, via.z))
  pts.push(new THREE.Vector3(target.x, 0, target.z))
  return pts
}

/**
 * Is the doorway still on the way, or is the player through it?
 *
 * Standing on the via is the obvious case and was the only one the first pass
 * checked. It is not enough. The player who has taken three paces into the
 * clearing is more than `VIA_REACHED` from the gap again, and a route that
 * still bends through it runs from their feet *backwards* out of the doorway
 * before turning round for the pocket — a trail whose first two arrows point
 * the way you came is worse than no trail, because it teaches the player that
 * the arrows do not mean anything.
 *
 * "Through" is therefore measured along the via→target axis, and inside a cone
 * rather than across the whole half-plane. A player level with the doorway but
 * thirty units up the beach is on the target's side of that dividing line and
 * has emphatically not walked through anything; their route still has to come
 * back to the gap or it points at a wall. The cone opens at forty-five degrees
 * from the via and starts a stride wide, so it does not pinch to nothing right
 * in the mouth of the doorway where the player actually is.
 */
function viaPending(from: THREE.Vector3, via: THREE.Vector3, target: THREE.Vector3) {
  const dx = via.x - from.x
  const dz = via.z - from.z
  if (dx * dx + dz * dz <= VIA_REACHED * VIA_REACHED) return false

  const ax = target.x - via.x
  const az = target.z - via.z
  const axis = Math.hypot(ax, az)
  // Target sitting on the via: there is no "past" to be, so honour the via and
  // let the near-fade swallow the stub.
  if (axis < 1e-4) return true

  const ux = ax / axis
  const uz = az / axis
  const px = from.x - via.x
  const pz = from.z - via.z
  const along = px * ux + pz * uz
  if (along <= 0) return true
  const lateral = Math.abs(px * uz - pz * ux)
  return lateral > along + VIA_REACHED
}

/**
 * Trails drawn at once.
 *
 * The opening asks for three — one per seed crate — because "collect all of
 * these" is a different instruction from "go here", and drawing only the trail
 * to the nearest crate says the wrong one: the player follows it, picks the
 * barrel up, and the guide then jumps to a barrel behind them. Four is that
 * case plus a spare.
 */
const LANES = 4

/** One trail: its own destination, its own solved route, its own arrows. */
class Lane {
  target: THREE.Vector3 | null = null
  /** A point the route must pass through on the way. Direct mode only. */
  via: THREE.Vector3 | null = null
  route: THREE.Vector3[] = []
  routeAge = 0
  /** Where the player was when this route was last solved. */
  readonly solvedAt = new THREE.Vector3(1e9, 0, 0)
  readonly arrows: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
}

/** A destination, with an optional waypoint the trail has to bend through. */
export interface GuideTarget {
  point: THREE.Vector3
  /**
   * Somewhere the route must pass. The opening uses it for the treeline
   * doorway: the pocket is four units past a wall with one gap in it, and a
   * trail drawn straight at it points through the foliage.
   *
   * Dropped automatically once the player is standing on it, so the trail does
   * not kink backwards through a doorway they have already walked out of.
   */
  via?: THREE.Vector3 | null
}

export interface GuidePathOptions {
  /**
   * Chevron colour. Defaults to the gold the village has always used; the isle
   * opening passes PULSE_IVORY, because lotto gold is reserved for luck and the
   * beat-8 payoff depends on gold never having appeared before it.
   */
  color?: number
  /**
   * Skip the village waypoint graph and lay the route directly — see the
   * "direct mode" paragraph at the top of the file.
   */
  direct?: boolean
}

/** How close counts as standing on a via point, so it can be dropped. */
const VIA_REACHED = 1.3

function sameVia(a: THREE.Vector3 | null, b: THREE.Vector3 | null) {
  if (!a || !b) return !a === !b
  return a.distanceToSquared(b) < 0.25
}

export class GuidePath {
  readonly group = new THREE.Group()

  private readonly lanes: Lane[] = []
  /* Shared by every lane, so the arrows flow in step. Three trails scrolling at
     their own offsets read as three unrelated effects. */
  private phase = 0
  private readonly direct: boolean
  private color: number

  constructor(options: GuidePathOptions = {}) {
    this.direct = options.direct ?? false
    this.color = options.color ?? GUIDE_GOLD
    const palette = paletteFor(this.color)
    this.group.visible = false
    // Drawn after the ground and its decals, and writing no depth of its own, so
    // it never fights the quads it lies on.
    this.group.renderOrder = 3
    for (let l = 0; l < LANES; l++) {
      const lane = new Lane()
      for (let i = 0; i < COUNT; i++) {
        const mesh = new THREE.Mesh(
          CHEVRON,
          // Unlit and pushed past white, the same trick the "!" marker uses: at a
          // night grade a flat mid-gold reads as dull brown, and blowing through
          // the tone map is what makes this look like it is glowing rather than
          // painted on the grass. The boost lifts every band of the sticker
          // together, so the keyline stays a keyline.
          new THREE.MeshBasicMaterial({
            map: chevronTexture(this.color),
            color: 0xffffff,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        )
        mesh.material.color.multiplyScalar(palette.boost)
        mesh.renderOrder = 3
        mesh.visible = false
        lane.arrows.push(mesh)
        this.group.add(mesh)
      }
      this.lanes.push(lane)
    }
  }

  /**
   * Repaint the trail.
   *
   * Cheap enough to call whenever: the texture for a given colour is built once
   * and then handed out, so a caller that flips between two colours pays for
   * each of them exactly one canvas.
   */
  setColor(hex: number) {
    if (hex === this.color) return
    this.color = hex
    const palette = paletteFor(hex)
    const map = chevronTexture(hex)
    for (const lane of this.lanes) {
      for (const arrow of lane.arrows) {
        arrow.material.map = map
        arrow.material.color.setScalar(1).multiplyScalar(palette.boost)
        arrow.material.needsUpdate = true
      }
    }
  }

  /** Point somewhere, or pass null to put the trail away. */
  setTarget(target: THREE.Vector3 | null, via: THREE.Vector3 | null = null) {
    this.setTargets(target ? [{ point: target, via }] : [])
  }

  /** Run a trail to each of these, up to LANES of them. */
  setTargets(targets: readonly (THREE.Vector3 | GuideTarget)[]) {
    this.group.visible = targets.length > 0
    for (let i = 0; i < this.lanes.length; i++) {
      const lane = this.lanes[i]
      const spec = targets[i] ?? null
      const target = spec === null ? null : spec instanceof THREE.Vector3 ? spec : spec.point
      const via = spec === null || spec instanceof THREE.Vector3 ? null : (spec.via ?? null)
      // Same destination as last frame: keep the solved route. The caller hands
      // over fresh vectors every frame, so this compares position, not identity.
      if (
        target &&
        lane.target &&
        lane.target.distanceToSquared(target) < 0.25 &&
        sameVia(lane.via, via)
      ) {
        continue
      }

      lane.target = target ? target.clone() : null
      lane.via = via ? via.clone() : null
      lane.route = []
      // Force a re-solve: the old route led somewhere else entirely.
      lane.solvedAt.set(1e9, 0, 0)
      if (!target) for (const arrow of lane.arrows) arrow.visible = false
    }
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.group.visible) return
    this.phase = (this.phase + dt * FLOW * SPACING) % SPACING
    for (const lane of this.lanes) this.updateLane(lane, dt, playerPos)
  }

  private updateLane(lane: Lane, dt: number, playerPos: THREE.Vector3) {
    if (!lane.target) return

    /*
     * Re-solve on movement, not every frame.
     *
     * Each hop is a Dijkstra over the waypoint graph and the route is up to eight
     * of them; at sixty frames a second that is real work to produce the same
     * answer, since the route only changes when the player walks somewhere new.
     */
    lane.routeAge += dt
    // Direct mode's "solve" is two vector copies, so it can afford to track the
    // player far more closely — and it has to, because with the short lead its
    // first arrow is barely a stride out and a stale route leaves that arrow
    // behind the player's heels.
    const settleTime = this.direct ? 0.1 : 0.35
    const settleDist = this.direct ? 0.04 : 0.36
    if (lane.routeAge > settleTime && lane.solvedAt.distanceToSquared(playerPos) > settleDist) {
      lane.routeAge = 0
      lane.solvedAt.copy(playerPos)
      lane.route = this.direct
        ? directRoute(playerPos, lane.target, lane.via)
        : this.solve(playerPos, lane.target)
    }
    if (lane.route.length === 0) return

    // Total walkable length, so the trail can fade out where the route ends
    // rather than stopping dead in the middle of the square.
    let total = 0
    for (let i = 1; i < lane.route.length; i++) total += lane.route[i - 1].distanceTo(lane.route[i])

    const lead = this.direct ? LEAD_DIRECT : LEAD
    for (let i = 0; i < lane.arrows.length; i++) {
      const arrow = lane.arrows[i]
      const along = lead + i * SPACING + this.phase
      if (along > Math.min(LENGTH, total)) {
        arrow.visible = false
        continue
      }
      const heading = this.sample(lane.route, along, scratch)
      arrow.visible = true
      arrow.position.set(scratch.x, groundHeight(scratch.x, scratch.z) + Y, scratch.z)
      arrow.rotation.set(0, heading, 0)
      /*
       * Lie along the slope, in direct mode only.
       *
       * The village is flat where its lanes are and the trail there has never
       * needed this. The opening's is drawn straight down a beach: a flat quad
       * 1.25 units long, held 7.5 cm above a bank falling at ten or fifteen
       * degrees, buries its leading edge in the sand and photographs as a
       * chopped-off arrow. Sampling the ground a half-length fore and aft and
       * pitching the quad to match costs two height lookups and puts the whole
       * mark on the surface.
       *
       * Rotating *after* setting the heading is what makes this one line: the
       * mesh's local X is the heading's right-hand axis by then, so a rotation
       * about it tips the arrow nose-up or nose-down along its own direction.
       */
      if (this.direct) {
        const fx = Math.sin(heading) * SIZE * 0.5
        const fz = Math.cos(heading) * SIZE * 0.5
        const rise =
          groundHeight(scratch.x + fx, scratch.z + fz) -
          groundHeight(scratch.x - fx, scratch.z - fz)
        arrow.rotateX(-Math.atan2(rise, SIZE))
      }
      /*
       * Fade in at the near end and out at the far one.
       *
       * The near fade hides the wrap — an arrow popping into existence a metre in
       * front of the player is the tell that this is a scrolling texture rather
       * than a path. The far fade stops the trail ending in a hard edge short of
       * its destination.
       */
      const fromEnd = Math.min(LENGTH, total) - along
      const fade = this.direct ? NEAR_FADE_DIRECT : NEAR_FADE
      arrow.material.opacity = Math.min(1, (along - lead) / fade, fromEnd / 2.4) * 0.85
    }
  }

  /**
   * Walk the waypoint graph out into a polyline.
   *
   * `routeToPoint` answers "where next", not "what route", so the path is built
   * by asking it repeatedly from each answer. The hop cap is a safety rail: the
   * graph is small and convex-ish so it converges in two or three, and a cap
   * means a future graph change cannot turn a signpost into a hang.
   */
  private solve(from: THREE.Vector3, target: THREE.Vector3) {
    const pts = [from.clone()]
    const cur = from.clone()

    // Fenced in: the only way out is the gate, and the outside graph does not
    // know about the interior.
    const slot = containingSlot(cur)
    if (slot) {
      const gate = exitWaypoint(cur, slot)
      pts.push(gate.clone())
      cur.copy(gate)
    }

    for (let hop = 0; hop < 8; hop++) {
      const next = routeToPoint(cur, target.x, target.z)
      if (next.distanceToSquared(cur) < 1e-4) break
      pts.push(next.clone())
      cur.copy(next)
      if (Math.hypot(next.x - target.x, next.z - target.z) < 0.5) break
    }

    /*
     * The rail: a solved route that goes nowhere becomes a straight line.
     *
     * `routeToPoint` answers with the *same point* when it has nothing to say —
     * which is what happens off the graph entirely, on a beach twenty units west
     * of the westernmost lane. The loop then breaks on its first hop and hands
     * back a one-point polyline, whose total length is zero, and every arrow in
     * `updateLane` fails the `along > total` test and switches itself off. The
     * trail does not point the wrong way in that case; it simply is not there,
     * which is the one failure a signpost cannot recover from.
     *
     * Deliberately gated on the route being *unusable*, not on it being short.
     * Anything the graph actually walked is left exactly as the village has
     * always drawn it — this cannot straighten a lane trail through a fence.
     */
    let total = 0
    for (let i = 1; i < pts.length; i++) total += pts[i - 1].distanceTo(pts[i])
    if (total < 0.5) return [from.clone(), target.clone()]
    return pts
  }

  /** Position at `along` metres down a route, and the heading there. */
  private sample(route: THREE.Vector3[], along: number, out: THREE.Vector3) {
    let left = along
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]
      const b = route[i]
      const len = a.distanceTo(b)
      if (len < 1e-4) continue
      if (left <= len) {
        out.lerpVectors(a, b, left / len)
        return Math.atan2(b.x - a.x, b.z - a.z)
      }
      left -= len
    }
    const last = route[route.length - 1]
    const prev = route[Math.max(0, route.length - 2)]
    out.copy(last)
    return Math.atan2(last.x - prev.x, last.z - prev.z)
  }
}
