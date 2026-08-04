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

/** Distance between chevrons along the path. */
const SPACING = 0.95
/** How far along the route the trail is drawn. Enough to commit to a direction. */
const LENGTH = 16
/** How far ahead of the player the trail starts, so it is not under their feet. */
const LEAD = 1.1
/** Arrows per second flowing along it. */
const FLOW = 1.6
/** Above the lane and scatter decals — see the Y ladder in world.ts. */
const Y = 0.075

const COUNT = Math.ceil(LENGTH / SPACING)

/**
 * A fat chevron pointing along +Z, lying in the XY plane so it can be laid flat.
 *
 * The same shape as the home marker, deliberately: the game already teaches that
 * a gold chevron means "here", so a line of them means "this way" without
 * needing to teach anything new.
 */
const CHEVRON = (() => {
  const s = new THREE.Shape()
  s.moveTo(-0.34, -0.30)
  s.lineTo(0, 0.24)
  s.lineTo(0.34, -0.30)
  s.lineTo(0.34, -0.02)
  s.lineTo(0, 0.5)
  s.lineTo(-0.34, -0.02)
  s.closePath()
  const geo = new THREE.ShapeGeometry(s)
  /*
   * Lay it flat, then spin it half a turn.
   *
   * Both steps are needed and neither is optional. `rotateX(-90°)` is the one
   * that leaves the face normal pointing *up* — the opposite sign lays it just as
   * flat but face-down, and a FrontSide material then draws nothing at all from
   * a camera above it. That rotation also carries the shape's +Y tip round to
   * -Z, so every arrow pointed back the way the player had come; the half turn
   * about Y puts the tip on +Z without touching the normal, which is what makes
   * a mesh's `rotation.y` simply its heading.
   */
  geo.rotateX(-Math.PI / 2)
  geo.rotateY(Math.PI)
  return geo
})()

const scratch = new THREE.Vector3()

export class GuidePath {
  readonly group = new THREE.Group()

  private readonly arrows: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []
  private target: THREE.Vector3 | null = null
  /** The walked route, as a polyline starting near the player. */
  private route: THREE.Vector3[] = []
  private routeAge = 0
  /** Where the player was when the route was last solved. */
  private readonly solvedAt = new THREE.Vector3(1e9, 0, 0)
  private phase = 0

  constructor() {
    this.group.visible = false
    // Drawn after the ground and its decals, and writing no depth of its own, so
    // it never fights the quads it lies on.
    this.group.renderOrder = 3
    for (let i = 0; i < COUNT; i++) {
      const mesh = new THREE.Mesh(
        CHEVRON,
        // Unlit and pushed past white, the same trick the "!" marker uses: at a
        // night grade a flat mid-gold reads as dull brown, and blowing through
        // the tone map is what makes this look like it is glowing rather than
        // painted on the grass.
        new THREE.MeshBasicMaterial({
          color: 0xffd062,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      mesh.material.color.multiplyScalar(1.9)
      mesh.renderOrder = 3
      this.arrows.push(mesh)
      this.group.add(mesh)
    }
  }

  /** Point somewhere, or pass null to put the trail away. */
  setTarget(target: THREE.Vector3 | null) {
    this.target = target ? target.clone() : null
    this.group.visible = target !== null
    // Force a re-solve: the old route led somewhere else entirely.
    this.solvedAt.set(1e9, 0, 0)
  }

  update(dt: number, playerPos: THREE.Vector3) {
    if (!this.target) return

    /*
     * Re-solve on movement, not every frame.
     *
     * Each hop is a Dijkstra over the waypoint graph and the route is up to eight
     * of them; at sixty frames a second that is real work to produce the same
     * answer, since the route only changes when the player walks somewhere new.
     */
    this.routeAge += dt
    if (this.routeAge > 0.35 && this.solvedAt.distanceToSquared(playerPos) > 0.36) {
      this.routeAge = 0
      this.solvedAt.copy(playerPos)
      this.route = this.solve(playerPos, this.target)
    }
    if (this.route.length === 0) return

    this.phase = (this.phase + dt * FLOW * SPACING) % SPACING

    // Total walkable length, so the trail can fade out where the route ends
    // rather than stopping dead in the middle of the square.
    let total = 0
    for (let i = 1; i < this.route.length; i++) total += this.route[i - 1].distanceTo(this.route[i])

    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i]
      const along = LEAD + i * SPACING + this.phase
      if (along > Math.min(LENGTH, total)) {
        arrow.visible = false
        continue
      }
      const heading = this.sample(along, scratch)
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

  /** Position at `along` metres down the route, and the heading there. */
  private sample(along: number, out: THREE.Vector3) {
    let left = along
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1]
      const b = this.route[i]
      const len = a.distanceTo(b)
      if (len < 1e-4) continue
      if (left <= len) {
        out.lerpVectors(a, b, left / len)
        return Math.atan2(b.x - a.x, b.z - a.z)
      }
      left -= len
    }
    const last = this.route[this.route.length - 1]
    const prev = this.route[Math.max(0, this.route.length - 2)]
    out.copy(last)
    return Math.atan2(last.x - prev.x, last.z - prev.z)
  }
}
