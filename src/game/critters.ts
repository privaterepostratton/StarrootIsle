import * as THREE from 'three'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import { MINOR_LAYER } from '../assets/style'
import { groundHeight, isSand, isWalkable, WALK_LIMIT } from './terrain'

/**
 * Hermit crabs on the beach.
 *
 * Scenery with legs. The valley's other animals are all mechanisms — livestock
 * to collect from, wild ones to tame — and the beach had none of either, which
 * left the whole seaward half of the map as a place things wash up rather than
 * a place anything *lives*. These cannot be tamed, collected, fed or bought.
 * They scuttle away when you get close and that is the entire feature: the
 * beach is inhabited, and walking down it does something.
 *
 * Not saved, for the same reason the wild animals are not — there is no state
 * here worth carrying between sessions, and a fresh scatter each boot is one
 * less thing that can be restored into a spot the coast no longer has.
 */

/** How many crabs the beach carries at once. */
const POPULATION = 16

/** Inside this range of the player a crab breaks off and runs. */
const FLEE_RANGE = 4.2
/** It keeps running until it is at least this far away. */
const SAFE_RANGE = 7.5

/** Amble, and bolt. A crab does not have a middle gear. */
const AMBLE_SPEED = 0.55
const FLEE_SPEED = 2.9

/**
 * Beyond this from the player nothing is stepped at all.
 *
 * Sixteen crabs is sixteen ground lookups and a matrix write per frame for
 * animals that are, at forty metres, three pixels of orange on a beach. The
 * whole population is usually out of range: the beach is one edge of the map.
 */
const ACTIVE_RANGE = 34

interface Crab {
  object: THREE.Group
  pos: THREE.Vector2
  target: THREE.Vector2
  /** Which way it is walking, in radians. Crabs walk sideways — see update. */
  heading: number
  /** Seconds left of standing still. */
  idle: number
  fleeing: boolean
  /** Per-crab animation offset, so a beach of them is not one animation. */
  phase: number
  scale: number
}

export class Critters {
  readonly group = new THREE.Group()
  private readonly crabs: Crab[] = []

  constructor(private readonly rng: () => number = Math.random) {
    for (let i = 0; i < POPULATION; i++) {
      const spot = this.findSand()
      // The coast is generous, but a run of failed samples is not worth
      // retrying forever — a beach with fourteen crabs on it looks the same as
      // one with sixteen.
      if (!spot) continue

      const scale = 0.75 + this.rng() * 0.5
      const object = modelGroup(getModels().crab, PROP_HEIGHT.crab * scale)
      object.position.set(spot.x, groundHeight(spot.x, spot.z), spot.z)
      // Crabs are small and there are a lot of them: they belong on the layer
      // the game already reserves for detail it can afford to drop.
      object.traverse((o) => o.layers.set(MINOR_LAYER))
      this.group.add(object)

      const pos = new THREE.Vector2(spot.x, spot.z)
      this.crabs.push({
        object,
        pos,
        target: pos.clone(),
        heading: this.rng() * Math.PI * 2,
        idle: this.rng() * 3,
        fleeing: false,
        phase: this.rng() * Math.PI * 2,
        scale,
      })
    }
  }

  /** A patch of sand anywhere on the coast, or null if the sampling missed. */
  private findSand() {
    for (let i = 0; i < 80; i++) {
      const angle = this.rng() * Math.PI * 2
      // sqrt keeps the sample even by area rather than crowding the middle.
      const reach = Math.sqrt(this.rng()) * WALK_LIMIT
      const x = Math.cos(angle) * reach
      const z = Math.sin(angle) * reach
      if (!isSand(x, z) || !isWalkable(x, z)) continue
      return { x, z }
    }
    return null
  }

  /** Somewhere to amble to: a short hop that stays on the sand. */
  private wanderTarget(from: THREE.Vector2, minDist: number, away: THREE.Vector2 | null) {
    for (let i = 0; i < 12; i++) {
      /*
       * A fleeing crab picks its direction *away* from the player rather than
       * at random, but only roughly — a crab that runs on the exact opposite
       * bearing is a shape being repelled by a point, and reads as physics. The
       * spread is what makes it look like an animal choosing badly.
       */
      const base = away ? Math.atan2(from.y - away.y, from.x - away.x) : this.rng() * Math.PI * 2
      const angle = base + (away ? (this.rng() - 0.5) * 1.6 : 0)
      const dist = minDist + this.rng() * minDist
      const x = from.x + Math.cos(angle) * dist
      const z = from.y + Math.sin(angle) * dist
      if (!isSand(x, z) || !isWalkable(x, z)) continue
      return new THREE.Vector2(x, z)
    }
    return null
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3) {
    for (const crab of this.crabs) {
      const toPlayer = Math.hypot(playerPos.x - crab.pos.x, playerPos.z - crab.pos.y)
      if (toPlayer > ACTIVE_RANGE) {
        crab.object.visible = false
        continue
      }
      crab.object.visible = true

      // Spooked: drop whatever it was doing and pick a way out.
      if (!crab.fleeing && toPlayer < FLEE_RANGE) {
        crab.fleeing = true
        crab.idle = 0
        const escape = this.wanderTarget(crab.pos, 5, new THREE.Vector2(playerPos.x, playerPos.z))
        if (escape) crab.target.copy(escape)
      } else if (crab.fleeing && toPlayer > SAFE_RANGE) {
        crab.fleeing = false
        crab.idle = 0.4 + this.rng() * 1.6
      }

      const dx = crab.target.x - crab.pos.x
      const dz = crab.target.y - crab.pos.y
      const dist = Math.hypot(dx, dz)

      if (crab.idle > 0 && !crab.fleeing) {
        crab.idle -= dt
      } else if (dist < 0.12) {
        // Arrived. Stand about, unless it is still running.
        if (crab.fleeing) {
          const escape = this.wanderTarget(crab.pos, 5, new THREE.Vector2(playerPos.x, playerPos.z))
          if (escape) crab.target.copy(escape)
        } else {
          crab.idle = 0.8 + this.rng() * 3.4
          const next = this.wanderTarget(crab.pos, 1.6, null)
          if (next) crab.target.copy(next)
        }
      } else {
        const speed = crab.fleeing ? FLEE_SPEED : AMBLE_SPEED
        const step = Math.min(dist, speed * dt)
        crab.pos.x += (dx / dist) * step
        crab.pos.y += (dz / dist) * step
        crab.heading = Math.atan2(dx, dz)
      }

      const y = groundHeight(crab.pos.x, crab.pos.y)
      /*
       * Sideways, because that is how a crab walks.
       *
       * The model faces down its own +Z like everything else in the game, so
       * turning it to face the way it is going would give a crab that walks
       * forwards — which is the one thing everybody knows a crab does not do.
       * A quarter turn puts its shoulder into the direction of travel.
       */
      crab.object.rotation.y = crab.heading + Math.PI / 2
      // A scuttle, not a glide: the body rocks in step, faster when running.
      const rock = crab.fleeing ? 18 : 7
      const moving = crab.idle <= 0 || crab.fleeing
      const bob = moving ? Math.abs(Math.sin(elapsed * rock + crab.phase)) * 0.03 * crab.scale : 0
      crab.object.position.set(crab.pos.x, y + bob, crab.pos.y)
      crab.object.rotation.z = moving ? Math.sin(elapsed * rock + crab.phase) * 0.12 : 0
    }
  }
}
