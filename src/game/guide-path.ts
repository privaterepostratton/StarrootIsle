import * as THREE from 'three'
import { groundHeight } from './terrain'
import { containingSlot, exitWaypoint, routeToPoint } from './village-router'

/**
 * A golden trail of chevrons laid on the ground, flowing toward somewhere the
 * player needs to go.
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
 */

/** Distance between chevrons along the path. Tracks SIZE — they must not touch. */
const SPACING = 1.05
/** How far along the route the trail is drawn. Enough to commit to a direction. */
const LENGTH = 16
/** How far ahead of the player the trail starts, so it is not under their feet. */
const LEAD = 1.1
/** Arrows per second flowing along it. */
const FLOW = 1.6
/** Above the lane and scatter decals — see the Y ladder in world.ts. */
const Y = 0.075

const COUNT = Math.ceil(LENGTH / SPACING)

/** How big one mark on the ground is, in world units. */
const SIZE = 1.25

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
 */
const CHEVRON_TEXTURE = (() => {
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

  /*
   * Widest stroke first, then narrower, then the fill.
   *
   * Each stroke straddles the outline, so the next one over-paints its inner
   * half and the fill over-paints what is left inside: what survives is a
   * keyline, a shade band and a clean face, from one path drawn three times.
   * Round joins are what make the corners chunky rather than mitred to points.
   */
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#fffdf2'
  ctx.lineWidth = S * 0.15
  ctx.stroke(path)
  ctx.strokeStyle = '#a2670f'
  ctx.lineWidth = S * 0.08
  ctx.stroke(path)
  ctx.fillStyle = '#ffd062'
  ctx.fill(path)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
})()

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
  route: THREE.Vector3[] = []
  routeAge = 0
  /** Where the player was when this route was last solved. */
  readonly solvedAt = new THREE.Vector3(1e9, 0, 0)
  readonly arrows: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
}

export class GuidePath {
  readonly group = new THREE.Group()

  private readonly lanes: Lane[] = []
  /* Shared by every lane, so the arrows flow in step. Three trails scrolling at
     their own offsets read as three unrelated effects. */
  private phase = 0

  constructor() {
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
            map: CHEVRON_TEXTURE,
            color: 0xffffff,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        )
        mesh.material.color.multiplyScalar(1.45)
        mesh.renderOrder = 3
        mesh.visible = false
        lane.arrows.push(mesh)
        this.group.add(mesh)
      }
      this.lanes.push(lane)
    }
  }

  /** Point somewhere, or pass null to put the trail away. */
  setTarget(target: THREE.Vector3 | null) {
    this.setTargets(target ? [target] : [])
  }

  /** Run a trail to each of these, up to LANES of them. */
  setTargets(targets: readonly THREE.Vector3[]) {
    this.group.visible = targets.length > 0
    for (let i = 0; i < this.lanes.length; i++) {
      const lane = this.lanes[i]
      const target = targets[i] ?? null
      // Same destination as last frame: keep the solved route. The caller hands
      // over fresh vectors every frame, so this compares position, not identity.
      if (target && lane.target && lane.target.distanceToSquared(target) < 0.25) continue

      lane.target = target ? target.clone() : null
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
    if (lane.routeAge > 0.35 && lane.solvedAt.distanceToSquared(playerPos) > 0.36) {
      lane.routeAge = 0
      lane.solvedAt.copy(playerPos)
      lane.route = this.solve(playerPos, lane.target)
    }
    if (lane.route.length === 0) return

    // Total walkable length, so the trail can fade out where the route ends
    // rather than stopping dead in the middle of the square.
    let total = 0
    for (let i = 1; i < lane.route.length; i++) total += lane.route[i - 1].distanceTo(lane.route[i])

    for (let i = 0; i < lane.arrows.length; i++) {
      const arrow = lane.arrows[i]
      const along = LEAD + i * SPACING + this.phase
      if (along > Math.min(LENGTH, total)) {
        arrow.visible = false
        continue
      }
      const heading = this.sample(lane.route, along, scratch)
      arrow.visible = true
      arrow.position.set(scratch.x, groundHeight(scratch.x, scratch.z) + Y, scratch.z)
      arrow.rotation.y = heading
      /*
       * Fade in at the near end and out at the far one.
       *
       * The near fade hides the wrap — an arrow popping into existence a metre in
       * front of the player is the tell that this is a scrolling texture rather
       * than a path. The far fade stops the trail ending in a hard edge short of
       * its destination.
       */
      const fromEnd = Math.min(LENGTH, total) - along
      arrow.material.opacity = Math.min(1, (along - LEAD) / 1.6, fromEnd / 2.4) * 0.85
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
