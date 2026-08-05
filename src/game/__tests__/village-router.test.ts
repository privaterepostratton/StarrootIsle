import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { nextWaypoint, exitWaypoint, containingSlot, routeToPoint } from '../village-router'
import {
  FENCED_PLOTS,
  NEIGHBOUR_SLOTS,
  PLAYER_SLOT,
  FENCE_HX,
  FENCE_HZ,
  gatePos,
  towardLane,
  fenceHalfAlong,
} from '../village'

/**
 * The router is exercised the way the game uses it: a walker that asks for the
 * next waypoint every step and moves toward it. If the router is sound, every
 * spawn angle converges on the goal without ever standing still and without
 * ever being inside a *foreign* farm's fences. These tests exist because three
 * generations of steering heuristics each passed casual testing and then
 * livelocked on some angle nobody tried — the walker tries all of them.
 */

const STEP = 4.4 / 30 // one 30Hz frame at run speed

function insideForeign(pos: THREE.Vector3, target = PLAYER_SLOT) {
  // Every neighbour plot is foreign now — the player's is no longer among them.
  for (const s of NEIGHBOUR_SLOTS) {
    if (s === target) continue
    if (Math.abs(pos.x - s.x) < FENCE_HX - 0.05 && Math.abs(pos.z - s.z) < FENCE_HZ - 0.05) {
      return true
    }
  }
  return false
}

function walkIn(spawnDeg: number, goal: THREE.Vector3) {
  const a = (spawnDeg * Math.PI) / 180
  /*
   * The ring has to clear every fence, including the player's own.
   *
   * It was 46, chosen when the player farmed a lane plot and everything fenced
   * sat within about 28 of the origin. The farm is a coastal clearing now,
   * centred 38 out, so a spawn due west landed *inside* the target plot and the
   * gate test could never observe an entry.
   */
  const pos = new THREE.Vector3(Math.cos(a) * 62, 0, Math.sin(a) * 62)
  let stalledFrames = 0

  for (let i = 0; i < 30 * 240; i++) {
    const wp = nextWaypoint(pos, goal, PLAYER_SLOT)
    const dx = wp.x - pos.x
    const dz = wp.z - pos.z
    const dist = Math.hypot(dx, dz)

    if (Math.hypot(goal.x - pos.x, goal.z - pos.z) < 0.6) return { ok: true, seconds: i / 30 }

    if (dist < 1e-3) {
      // Standing on the waypoint and not at the goal: only legal transiently.
      if (++stalledFrames > 30) return { ok: false, why: `stalled at ${pos.x},${pos.z}` }
      continue
    }
    stalledFrames = 0
    const step = Math.min(dist, STEP)
    pos.x += (dx / dist) * step
    pos.z += (dz / dist) * step

    if (insideForeign(pos)) return { ok: false, why: `crossed foreign fence at ${pos.x},${pos.z}` }
  }
  return { ok: false, why: 'timed out' }
}

describe('village router', () => {
  const goal = new THREE.Vector3(PLAYER_SLOT.x + 2, 0, PLAYER_SLOT.z - 3)

  it('reaches the player farm from every spawn angle', () => {
    for (let deg = 0; deg < 360; deg += 15) {
      const r = walkIn(deg, goal)
      expect(r.ok, `spawn ${deg}°: ${'why' in r ? r.why : ''}`).toBe(true)
    }
  })

  it('reaches every other farm too', () => {
    for (const slot of FENCED_PLOTS) {
      const g = new THREE.Vector3(slot.x - 1.5, 0, slot.z + 2)
      const a = Math.atan2(slot.z, slot.x) + 0.5
      /*
   * The ring has to clear every fence, including the player's own.
   *
   * It was 46, chosen when the player farmed a lane plot and everything fenced
   * sat within about 28 of the origin. The farm is a coastal clearing now,
   * centred 38 out, so a spawn due west landed *inside* the target plot and the
   * gate test could never observe an entry.
   */
  const pos = new THREE.Vector3(Math.cos(a) * 62, 0, Math.sin(a) * 62)
      let ok = false
      for (let i = 0; i < 30 * 240; i++) {
        const wp = nextWaypoint(pos, g, slot)
        const dx = wp.x - pos.x
        const dz = wp.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (Math.hypot(g.x - pos.x, g.z - pos.z) < 0.6) {
          ok = true
          break
        }
        if (dist < 1e-3) continue
        const step = Math.min(dist, STEP)
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
      }
      expect(ok, `slot at ${slot.x},${slot.z}`).toBe(true)
    }
  })

  it('enters through the gate, never through a fence', () => {
    for (let deg = 0; deg < 360; deg += 45) {
      const a = (deg * Math.PI) / 180
      /*
   * The ring has to clear every fence, including the player's own.
   *
   * It was 46, chosen when the player farmed a lane plot and everything fenced
   * sat within about 28 of the origin. The farm is a coastal clearing now,
   * centred 38 out, so a spawn due west landed *inside* the target plot and the
   * gate test could never observe an entry.
   */
  const pos = new THREE.Vector3(Math.cos(a) * 62, 0, Math.sin(a) * 62)
      let entered = false
      for (let i = 0; i < 30 * 240 && !entered; i++) {
        const wasInside = containingSlot(pos) === PLAYER_SLOT
        const wp = nextWaypoint(pos, goal, PLAYER_SLOT)
        const dx = wp.x - pos.x
        const dz = wp.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist > 1e-3) {
          const step = Math.min(dist, STEP)
          pos.x += (dx / dist) * step
          pos.z += (dz / dist) * step
        }
        if (!wasInside && containingSlot(pos) === PLAYER_SLOT) {
          entered = true
          /*
           * Either gate, not just the lane one.
           *
           * The player's clearing has two openings: the lane gate, and a second
           * on the far side facing the beach — it is there so that walking home
           * from the sea does not mean a lap of your own fence. A walker coming
           * from due west lines up with that one and goes straight in, which is
           * the whole point of it. What this test is guarding is that they came
           * through *an opening* rather than over the rails.
           */
          const gate = gatePos(PLAYER_SLOT)
          const back = towardLane(PLAYER_SLOT, -fenceHalfAlong(PLAYER_SLOT))
          const atGate = Math.min(
            Math.hypot(pos.x - gate.x, pos.z - gate.z),
            Math.hypot(pos.x - back.x, pos.z - back.z),
          )
          expect(atGate, `entry point ${atGate.toFixed(2)} from a gate at ${deg}°`).toBeLessThan(2.2)
        }
      }
      expect(entered, `never entered from ${deg}°`).toBe(true)
    }
  })

  it('flees from the gate mouth to the treeline without pinning', () => {
    // The historical failure: standing just outside the gate, the radial
    // treeline ray dives back through the farm rect and the fence pins the
    // escapee. Walk the routed flee from every farm's gate mouth.
    for (const slot of FENCED_PLOTS) {
      const pos = new THREE.Vector3(
        slot.x + slot.inward * (FENCE_HX + 1.9),
        0,
        slot.z - 1.4,
      )
      let out = false
      for (let i = 0; i < 30 * 180; i++) {
        const len = Math.hypot(pos.x, pos.z) || 1
        if (len > 51) {
          out = true
          break
        }
        const wp = routeToPoint(pos, (pos.x / len) * 52, (pos.z / len) * 52)
        const dx = wp.x - pos.x
        const dz = wp.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist < 1e-3) continue
        const step = Math.min(dist, STEP)
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
        if (insideForeign(pos, null as never)) {
          expect.fail(`flee crossed a fence at ${pos.x.toFixed(1)},${pos.z.toFixed(1)}`)
        }
      }
      expect(out, `flee from slot ${slot.x},${slot.z} never reached the treeline`).toBe(true)
    }
  })

  it('exits from anywhere inside via the gate', () => {
    for (const [ox, oz] of [
      [-4, -4],
      [4, 4],
      [-6, 5],
      [5, -6],
      [0, 0],
    ]) {
      const pos = new THREE.Vector3(PLAYER_SLOT.x + ox, 0, PLAYER_SLOT.z + oz)
      let out = false
      for (let i = 0; i < 30 * 120; i++) {
        const slot = containingSlot(pos)
        if (!slot) {
          out = true
          break
        }
        const wp = exitWaypoint(pos, slot)
        const dx = wp.x - pos.x
        const dz = wp.z - pos.z
        const dist = Math.hypot(dx, dz)
        if (dist < 1e-3) continue
        const step = Math.min(dist, STEP)
        pos.x += (dx / dist) * step
        pos.z += (dz / dist) * step
      }
      expect(out, `never exited from offset ${ox},${oz}`).toBe(true)
    }
  })
})
