import * as THREE from 'three'
import {
  FENCED_PLOTS,
  gatesOf,
  fenceHalfOf,
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

/*
 * Gate geometry, in terms of the slot's own axis rather than of X.
 *
 * A plot at the end of the street faces down it, so "am I lined up with the
 * opening" and "how far outside it am I" are questions about whichever axis
 * that plot fronts the lane with. These three read the axis off the slot so the
 * routing works the same for a farm beside the road and one at the head of it.
 */

/** Standing within the width of the gate opening, however it is oriented. */
function alignedWithGate(pos: THREE.Vector3, slot: FarmSlot) {
  const off = slot.axis === 'x' ? pos.z - slot.z : pos.x - slot.x
  return Math.abs(off) < 1.1
}

/** How far outside the gate this position is. Negative means already through. */
function gateDistance(pos: THREE.Vector3, gate: THREE.Vector3, slot: FarmSlot, sign: number) {
  const along = slot.axis === 'x' ? pos.x - gate.x : pos.z - gate.z
  return along * sign
}

/** A point a stride inside the gate, so a crossing completes rather than stalls. */
function justInsideGate(gate: THREE.Vector3, slot: FarmSlot, sign: number) {
  const inner = gate.clone()
  if (slot.axis === 'x') inner.x -= sign * 1.2
  else inner.z -= sign * 1.2
  return inner
}

/**
 * The way in or out that is actually nearest.
 *
 * A plot with two openings is only served correctly if the router picks the one
 * on the walker's own side — routing everything through the lane gate is what
 * sent the guide trail the length of the fence and round the back to reach a
 * mailbox a couple of paces behind the player.
 */
function nearestGate(pos: THREE.Vector3, slot: FarmSlot) {
  let best = gatesOf(slot)[0]
  let bestD = Infinity
  for (const g of gatesOf(slot)) {
    const d = Math.hypot(g.approach.x - pos.x, g.approach.z - pos.z)
    if (d < bestD) {
      bestD = d
      best = g
    }
  }
  return best
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
  // The player's yard is only as big as their garden has grown — see fenceHalfOf.
  const h = fenceHalfOf(s)
  return Math.abs(x - s.x) < h - shrink && Math.abs(z - s.z) < h - shrink
}

/**
 * A leg is legal when it crosses no farm rect — except the rect it starts or
 * ends inside, which is unavoidable and is policed by the gate topology
 * instead: interior points only ever connect to their own gate nodes.
 */
function legClear(x1: number, z1: number, x2: number, z2: number) {
  for (const s of FENCED_PLOTS) {
    if (insideRect(x1, z1, s) || insideRect(x2, z2, s)) continue
    const h = fenceHalfOf(s)
    if (segmentHitsRect(x1, z1, x2, z2, s.x, s.z, h + BLOCK_PAD, h + BLOCK_PAD)) {
      return false
    }
  }
  return true
}

// --- the static graph ---------------------------------------------------------

const nodes: Node[] = []
/** Per slot: index of its approach node (on the lane, outside the gate). */
const approachNode = new Map<FarmSlot, number>()

/**
 * Throw the graph away so the next query rebuilds it.
 *
 * The corner and approach nodes are positions on a fence, and the player's
 * fence moves when their garden grows — a cached graph would keep routing
 * around a boundary that is no longer there.
 */
export function invalidateRoutes() {
  nodes.length = 0
  approachNode.clear()
}

function buildGraph() {
  if (nodes.length > 0) return

  for (const s of FENCED_PLOTS) {
    // Four pushed corners: the turning points for going around this farm.
    const half = fenceHalfOf(s)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        nodes.push({
          x: s.x + sx * (half + CORNER_PUSH),
          z: s.z + sz * (half + CORNER_PUSH),
          edges: [],
        })
      }
    }
    // A node per opening — a plot with a second gate needs both on the graph or
    // half its approaches are unreachable.
    gatesOf(s).forEach((g, i) => {
      if (i === 0) approachNode.set(s, nodes.length)
      nodes.push({ x: g.approach.x, z: g.approach.z, edges: [] })
    })
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
  const near = nearestGate(pos, slot)
  if (alignedWithGate(pos, slot) && gateDistance(pos, near.gate, slot, near.sign) < 2.2) {
    return justInsideGate(near.gate, slot, near.sign)
  }

  return routeToPoint(pos, near.approach.x, near.approach.z)
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
  const near = nearestGate(pos, slot)
  if (!alignedWithGate(pos, slot)) return justInsideGate(near.gate, slot, near.sign)
  return near.approach.clone()
}

/** The slot whose fences contain this point, if any. */
export function containingSlot(pos: THREE.Vector3): FarmSlot | null {
  for (const s of FENCED_PLOTS) if (insideRect(pos.x, pos.z, s)) return s
  return null
}
