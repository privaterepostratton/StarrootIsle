import * as THREE from 'three'
import { groundHeight } from './terrain'

/**
 * Gold rings that sit around the things the tutorial is asking for.
 *
 * The guiding finger answers "which way", and the trail of chevrons answers
 * "how do I get there" — but neither says *what to touch* once the player is
 * standing in front of three barrels, four trees and a fence. A ring drawn on
 * the ground around each candidate does, and it keeps working from any camera
 * angle, at any zoom, on a target the finger is not currently picking.
 *
 * Every ring pulses on the same clock rather than each on its own phase: a set
 * of markers beating together reads as one instruction ("these"), and the same
 * markers beating out of step read as several competing ones.
 *
 * Depth-tested like the rest of the ground decals. The alternative — punching
 * them through the world so a crate behind a dune still shows — was tried and
 * looks wrong the moment the player walks onto a ring, because a marker that
 * ignores depth also paints straight over their boots. The trail and the finger
 * already cover a target you cannot see; these mark the ones you can.
 */

export interface RingTarget {
  x: number
  z: number
  /** World Y. Omit to lay the ring on the terrain, which is what most want. */
  y?: number
  /** Radius of the steady ring. The pulse expands out past it. */
  radius: number
}

/** Rings drawn at once. More than this on screen is noise, not guidance. */
const MAX = 8
/** Seconds per pulse. Slow enough to read as breathing rather than blinking. */
const PERIOD = 1.5
/** Clear of the ground decals — see the Y ladder in world.ts. */
const LIFT = 0.08

/** Unit-radius ring and fill, lying flat with their normals up. */
const RING_GEO = (() => {
  const g = new THREE.RingGeometry(0.74, 1, 56)
  g.rotateX(-Math.PI / 2)
  return g
})()
const FILL_GEO = (() => {
  const g = new THREE.CircleGeometry(0.74, 56)
  g.rotateX(-Math.PI / 2)
  return g
})()

/**
 * Unlit and pushed past white, the same trick the trail and the "!" marker use:
 * at a night grade a flat mid-gold reads as dull brown, and blowing through the
 * tone map is what makes this look lit rather than painted on.
 */
function goldMaterial(opacity: number) {
  const m = new THREE.MeshBasicMaterial({
    color: 0xffd062,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  })
  m.color.multiplyScalar(1.9)
  return m
}

interface Marker {
  ring: THREE.Mesh
  fill: THREE.Mesh
  pulse: THREE.Mesh
  radius: number
}

export class TargetRings {
  readonly group = new THREE.Group()

  /* One material per layer, shared by every marker — they pulse in lockstep, so
   * there is nothing per-marker to store and the whole set costs three uniform
   * writes a frame. */
  private readonly ringMat = goldMaterial(0.8)
  private readonly fillMat = goldMaterial(0.12)
  private readonly pulseMat = goldMaterial(0.5)
  private readonly markers: Marker[] = []
  private t = 0

  constructor() {
    this.group.visible = false
    this.group.renderOrder = 4
    for (let i = 0; i < MAX; i++) {
      const ring = new THREE.Mesh(RING_GEO, this.ringMat)
      const fill = new THREE.Mesh(FILL_GEO, this.fillMat)
      const pulse = new THREE.Mesh(RING_GEO, this.pulseMat)
      for (const m of [fill, ring, pulse]) {
        m.renderOrder = 4
        m.visible = false
        this.group.add(m)
      }
      this.markers.push({ ring, fill, pulse, radius: 1 })
    }
  }

  /** Ring these, and nothing else. Pass an empty list to put them away. */
  set(targets: readonly RingTarget[]) {
    this.group.visible = targets.length > 0
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i]
      const target = targets[i]
      if (!target) {
        marker.ring.visible = marker.fill.visible = marker.pulse.visible = false
        continue
      }
      const y = target.y ?? groundHeight(target.x, target.z) + LIFT
      marker.radius = target.radius
      for (const m of [marker.ring, marker.fill, marker.pulse]) {
        m.visible = true
        m.position.set(target.x, y, target.z)
      }
      marker.ring.scale.setScalar(target.radius)
      marker.fill.scale.setScalar(target.radius)
    }
  }

  update(dt: number) {
    if (!this.group.visible) return
    this.t += dt

    // The steady ring breathes; the pulse is a separate ring that starts on it
    // and expands away, which is what gives the marker a direction (outward,
    // toward you) instead of just a brightness.
    const phase = (this.t % PERIOD) / PERIOD
    this.ringMat.opacity = 0.62 + 0.26 * Math.sin(this.t * 4.2)
    this.fillMat.opacity = 0.1 + 0.06 * Math.sin(this.t * 4.2)
    this.pulseMat.opacity = 0.5 * (1 - phase) ** 1.6

    const spread = 1 + phase * 0.75
    for (const marker of this.markers) {
      if (!marker.pulse.visible) continue
      marker.pulse.scale.setScalar(marker.radius * spread)
    }
  }
}
