import * as THREE from 'three'
import {
  FENCED_PLOTS,
  FENCE_HX,
  FENCE_HZ,
  gatePos,
  approachPos,
  type FarmSlot,
} from './village'

/**
 * Legal routes through the village, as a tiny waypoint graph instead of
 * steering heuristics.
 *
 * Three rounds of "head for the gate unless blocked, then round a corner"
 * produced three different livelocks — every stateless rule had a boundary
 * where two waypoints disagreed, and anything standing on that boundary
 * vibrated in place. The honest fix is the classic one: nodes at every place a legal path
 * can turn (the pushed-out corners of each fenced farm, plus each farm's gate
 * approach), edges wherever the straight line between nodes crosses no fence,
 * and Dijkstra over the ~30 nodes. It terminates, it is provably legal, and at
 * this node count it costs microseconds — the whole graph is also static, so
 * everything but the endpoint edges is built exactly once.
 *
 * Fences are treated as solid rects with one opening each (the gate, on the
 * lane side). A leg may end inside a rect only by entering through that gate:
 * the inside endpoint connects to the world exclusively via its gate nodes.
 */

/** How far outside a fence the corner nodes sit. */
const CORNER_PUSH = 1.2
/**
 * Expansion applied to rects when testing legs.
 *
 * Raised from 0.4. The caller re-asks for a waypoint every frame and walks a
 * straight step toward whatever comes back, so the path actually travelled is a
 * chord across each turn rather than the polyline the search returned. At 0.4
 * that chord could clip the corner of a plot on a long route — which never came
 * up while every destination was a few plots down the same street, and did as
 * soon as the player's farm moved to the coast and paths ran the length of the
 * village. Wider legs leave room for the corner-cutting the walker does anyway.
 */
const BLOCK_PAD = 0.9

interface Node {
  x: number
  z: number
  /** Static neighbour indices, precomputed once. */
  edges: number[]
}

/** Liang-Barsky: does the segment cross this rect (expanded by pad)? */
function segmentHitsRect(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  cx: number,
  cz: number,
  hx: number,
  hz: number,
) {
  const dx = x2 - x1
  const dz = z2 - z1
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return (
    clip(-dx, x1 - (cx - hx)) &&
    clip(dx, cx + hx - x1) &&
    clip(-dz, z1 - (cz - hz)) &&
    clip(dz, cz + hz - z1)
  )
}

function insideRect(x: number, z: number, s: FarmSlot, shrink = 0) {
  return Math.abs(x - s.x) < FENCE_HX - shrink && Math.abs(z - s.z) < FENCE_HZ - shrink
}

/**
 * A leg is legal when it crosses no farm rect — except the rect it starts or
 * ends inside, which is unavoidable and is policed by the gate topology
 * instead: interior points only ever connect to their own gate nodes.
 */
function legClear(x1: number, z1: number, x2: number, z2: number) {
  for (const s of FENCED_PLOTS) {
    if (insideRect(x1, z1, s) || insideRect(x2, z2, s)) continue
    if (segmentHitsRect(x1, z1, x2, z2, s.x, s.z, FENCE_HX + BLOCK_PAD, FENCE_HZ + BLOCK_PAD)) {
      return false
    }
  }
  return true
}

// --- the static graph ---------------------------------------------------------

const nodes: Node[] = []
/** Per slot: index of its approach node (on the lane, outside the gate). */
const approachNode = new Map<FarmSlot, number>()

function buildGraph() {
  if (nodes.length > 0) return

  for (const s of FENCED_PLOTS) {
    // Four pushed corners: the turning points for going around this farm.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        nodes.push({
          x: s.x + sx * (FENCE_HX + CORNER_PUSH),
          z: s.z + sz * (FENCE_HZ + CORNER_PUSH),
          edges: [],
        })
      }
    }
    const a = approachPos(s)
    approachNode.set(s, nodes.length)
    nodes.push({ x: a.x, z: a.z, edges: [] })
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (legClear(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z)) {
        nodes[i].edges.push(j)
        nodes[j].edges.push(i)
      }
    }
  }
}

// --- per-query search ----------------------------------------------------------

const scratchDist: number[] = []
const scratchPrev: number[] = []

/**
 * The next point to walk toward on a legal path from `pos` to `goal`, where
 * `goal` lies inside `slot`'s fences.
 *
 * The interior is handled by construction rather than by search: the only way
 * in is the gate, so the path is (outside network) → approach → gate line →
 * goal, and the search only ever runs on the outside network. Returns the goal
 * itself once the caller is inside.
 */
export function nextWaypoint(
  pos: THREE.Vector3,
  goal: THREE.Vector3,
  slot: FarmSlot,
): THREE.Vector3 {
  buildGraph()

  // Already inside the target: the interior is convex and fence-free.
  if (insideRect(pos.x, pos.z, slot, 0.2)) return goal

  // On the gate leg: between the approach point and safely inside, aligned
  // with the opening. Aim past the line so the crossing completes.
  const gate = gatePos(slot)
  const onAxis = Math.abs(pos.z - slot.z) < 1.1
  const outward = (pos.x - gate.x) * slot.inward
  if (onAxis && outward < 2.2) {
    const inner = gate.clone()
    inner.x -= slot.inward * 1.2
    return inner
  }

  const a = approachPos(slot)
  return routeToPoint(pos, a.x, a.z)
}

/**
 * The next waypoint toward an arbitrary point in the *outside* network.
 *
 * Straight when the leg is clear. Otherwise Dijkstra rooted at a virtual node
 * for the target — seeded with every graph node that can see it — and the
 * traveller walks toward whichever visible node opens the cheapest total route.
 * Used both for reaching a farm's approach point and for routing back out to
 * the treeline, which is what forced the generalisation: the outbound ray had
 * exactly the same walks-into-a-fence failure the run-in legs had.
 */
export function routeToPoint(pos: THREE.Vector3, tx: number, tz: number): THREE.Vector3 {
  buildGraph()

  if (legClear(pos.x, pos.z, tx, tz)) return new THREE.Vector3(tx, 0, tz)

  const n = nodes.length
  scratchDist.length = n
  scratchPrev.length = n
  scratchPrev.fill(-1)
  const visited = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n; i++) {
    scratchDist[i] = legClear(nodes[i].x, nodes[i].z, tx, tz)
      ? Math.hypot(nodes[i].x - tx, nodes[i].z - tz)
      : Infinity
  }
  for (;;) {
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) {
      if (!visited[i] && scratchDist[i] < best) {
        best = scratchDist[i]
        u = i
      }
    }
    if (u === -1) break
    visited[u] = true
    for (const v of nodes[u].edges) {
      const w = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z)
      if (scratchDist[u] + w < scratchDist[v]) {
        scratchDist[v] = scratchDist[u] + w
        scratchPrev[v] = u
      }
    }
  }

  let bestNode = -1
  let bestTotal = Infinity
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(scratchDist[i])) continue
    if (!legClear(pos.x, pos.z, nodes[i].x, nodes[i].z)) continue
    const total = scratchDist[i] + Math.hypot(pos.x - nodes[i].x, pos.z - nodes[i].z)
    if (total < bestTotal) {
      bestTotal = total
      bestNode = i
    }
  }

  if (bestNode === -1) {
    // Boxed in (wedged against a fence): head for the nearest node and let
    // the wall ejection sort out the first step.
    let nearest = 0
    let nd = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pos.x - nodes[i].x, pos.z - nodes[i].z)
      if (d < nd) {
        nd = d
        nearest = i
      }
    }
    bestNode = nearest
  }
  return new THREE.Vector3(nodes[bestNode].x, 0, nodes[bestNode].z)
}

/** Exit waypoint for anything standing inside a farm: gate first, then out. */
export function exitWaypoint(pos: THREE.Vector3, slot: FarmSlot): THREE.Vector3 {
  const onAxis = Math.abs(pos.z - slot.z) < 1.1
  if (!onAxis) {
    const inner = gatePos(slot)
    inner.x -= slot.inward * 1.2
    return inner
  }
  const a = approachPos(slot)
  return new THREE.Vector3(a.x, 0, a.z)
}

/** The slot whose fences contain this point, if any. */
export function containingSlot(pos: THREE.Vector3): FarmSlot | null {
  for (const s of FENCED_PLOTS) if (insideRect(pos.x, pos.z, s)) return s
  return null
}
