import * as THREE from 'three'
import { createAnimalModel, createProductBubble, type AnimalRig } from '../assets/animal'
import { MINOR_LAYER } from '../assets/style'

/**
 * Livestock.
 *
 * Animals are the passive-income counterpart to crops: they cost far more up
 * front, but they produce forever without replanting and without a plot. The
 * trade is attention — a product sits uncollected until you walk over, so
 * animals reward returning rather than optimising a single session.
 */

export type AnimalSpecies = 'chicken' | 'sheep' | 'cow' | 'pig'

export interface AnimalDef {
  id: AnimalSpecies
  name: string
  emoji: string
  price: number
  unlockLevel: number
  /** Seconds between products. */
  interval: number
  product: { name: string; emoji: string; value: number; color: number }
  /** Movement speed in the pasture. */
  speed: number
  /** Collider radius, also used as the click radius. */
  radius: number
  xp: number
}

/**
 * How many animals the paddock holds.
 *
 * There was no limit before, and it never mattered: every animal had to be
 * bought, and the prices are steep enough that nobody was going to stand a
 * hundred chickens on seven metres of grass. Taming changes that — a chicken
 * costs one turnip, and turnips grow on day one — so the paddock needs a real
 * capacity or the free route becomes an unlimited one.
 *
 * The number is what fits: the paddock is a 7.5-unit circle, and past a dozen
 * animals they are visibly standing in each other.
 */
export const PASTURE_CAP = 12

export const ANIMALS: AnimalDef[] = [
  {
    id: 'chicken',
    name: 'Chicken',
    emoji: '🐔',
    price: 320,
    unlockLevel: 2,
    interval: 50,
    product: { name: 'Egg', emoji: '🥚', value: 34, color: 0xf5eeda },
    speed: 1.5,
    radius: 0.3,
    xp: 8,
  },
  {
    id: 'sheep',
    name: 'Sheep',
    emoji: '🐑',
    price: 1400,
    unlockLevel: 5,
    interval: 115,
    product: { name: 'Wool', emoji: '🧶', value: 165, color: 0xf4f1e8 },
    speed: 1.1,
    radius: 0.42,
    xp: 26,
  },
  {
    id: 'cow',
    name: 'Cow',
    emoji: '🐄',
    price: 3600,
    unlockLevel: 8,
    interval: 160,
    product: { name: 'Milk', emoji: '🥛', value: 380, color: 0xfbfbf6 },
    speed: 0.85,
    radius: 0.55,
    xp: 55,
  },
  {
    id: 'pig',
    name: 'Pig',
    emoji: '🐖',
    price: 11000,
    unlockLevel: 13,
    interval: 250,
    product: { name: 'Truffle', emoji: '🍄', value: 1250, color: 0x6b4a33 },
    speed: 1.25,
    radius: 0.4,
    xp: 140,
  },
]

export const ANIMAL_BY_ID = new Map(ANIMALS.map((a) => [a.id, a]))

/** Centre and radius of the fenced pasture the animals roam. Defined with the
 *  rest of the village layout and re-exported here for existing callers. */
export { PASTURE_CENTRE, PASTURE_RADIUS } from './village'
import { PASTURE_CENTRE, PASTURE_RADIUS } from './village'

interface Animal {
  def: AnimalDef
  rig: AnimalRig
  /** Current position on the pasture plane. */
  pos: THREE.Vector2
  /** Where it is wandering to. */
  target: THREE.Vector2
  facing: number
  /** Seconds until the next product. */
  timer: number
  /** True when a product is waiting to be collected. */
  ready: boolean
  bubble: THREE.Group | null
  /** Animation phase, offset per animal so a flock isn't in lockstep. */
  phase: number
  /** Seconds to stand still before choosing a new target. */
  idle: number
}

export class Pasture {
  readonly group = new THREE.Group()
  private readonly animals: Animal[] = []

  get count() {
    return this.animals.length
  }

  /** No room for another. Both the store and taming check this. */
  get isFull() {
    return this.animals.length >= PASTURE_CAP
  }

  countOf(id: AnimalSpecies) {
    return this.animals.filter((a) => a.def.id === id).length
  }

  add(def: AnimalDef, opts: { timer?: number; ready?: boolean } = {}) {
    const rig = createAnimalModel(def.id)
    this.group.add(rig.root)

    const pos = randomPointInPasture()
    const animal: Animal = {
      def,
      rig,
      pos,
      target: randomPointInPasture(),
      facing: Math.random() * Math.PI * 2,
      timer: opts.timer ?? def.interval,
      ready: opts.ready ?? false,
      bubble: null,
      phase: Math.random() * Math.PI * 2,
      idle: Math.random() * 2,
    }
    this.animals.push(animal)
    if (animal.ready) this.showBubble(animal)
    return animal
  }

  private showBubble(animal: Animal) {
    if (animal.bubble) return
    const bubble = createProductBubble(animal.def.product.color)
    bubble.layers.set(MINOR_LAYER)
    bubble.traverse((c) => c.layers.set(MINOR_LAYER))
    animal.rig.productAnchor.add(bubble)
    animal.bubble = bubble
  }

  private hideBubble(animal: Animal) {
    if (!animal.bubble) return
    animal.rig.productAnchor.remove(animal.bubble)
    animal.bubble = null
  }

  /**
   * Nearest animal with a ready product within `maxDist` of a world point.
   * Used for click-to-collect.
   */
  findReadyNear(point: THREE.Vector3, maxDist = 1.6): Animal | null {
    let best: Animal | null = null
    let bestDist = maxDist
    for (const animal of this.animals) {
      if (!animal.ready) continue
      const d = Math.hypot(animal.pos.x - point.x, animal.pos.y - point.z)
      if (d < bestDist) {
        best = animal
        bestDist = d
      }
    }
    return best
  }

  /** Collect from a specific animal. Returns what it produced. */
  collect(animal: Animal) {
    if (!animal.ready) return null
    animal.ready = false
    animal.timer = animal.def.interval
    this.hideBubble(animal)
    return animal.def
  }

  /** Collect everything at once. Returns totals per species. */
  collectAll() {
    const results: { def: AnimalDef; count: number }[] = []
    for (const animal of this.animals) {
      if (!animal.ready) continue
      this.collect(animal)
      const entry = results.find((r) => r.def.id === animal.def.id)
      if (entry) entry.count++
      else results.push({ def: animal.def, count: 1 })
    }
    return results
  }

  get readyCount() {
    return this.animals.filter((a) => a.ready).length
  }

  update(dt: number, elapsed: number, camera: THREE.Camera) {
    for (const animal of this.animals) {
      // --- production ------------------------------------------------------
      if (!animal.ready) {
        animal.timer -= dt
        if (animal.timer <= 0) {
          animal.ready = true
          this.showBubble(animal)
        }
      }

      // --- wander ----------------------------------------------------------
      const dx = animal.target.x - animal.pos.x
      const dz = animal.target.y - animal.pos.y
      const dist = Math.hypot(dx, dz)

      let moving = false
      if (animal.idle > 0) {
        animal.idle -= dt
      } else if (dist < 0.2) {
        // Arrived — stand around for a moment, then pick somewhere new.
        animal.idle = 1.5 + Math.random() * 3.5
        animal.target = randomPointInPasture()
      } else {
        moving = true
        const step = Math.min(dist, animal.def.speed * dt)
        animal.pos.x += (dx / dist) * step
        animal.pos.y += (dz / dist) * step

        const want = Math.atan2(dx, dz)
        animal.facing = angleLerp(animal.facing, want, Math.min(1, dt * 6))
      }

      animal.rig.root.position.set(animal.pos.x, 0, animal.pos.y)
      animal.rig.root.rotation.y = animal.facing

      // --- animation -------------------------------------------------------
      animal.phase += dt * (moving ? 7 : 1.6)
      const swing = moving ? Math.sin(animal.phase) * 0.6 : 0
      animal.rig.legs.forEach((l, i) => {
        // Diagonal pairs swing together, which is what makes a quadruped walk
        // read as a walk rather than a shuffle.
        l.rotation.x = swing * (i === 0 || i === 3 ? 1 : -1)
      })

      const baseY = animal.rig.body.position.y
      animal.rig.body.position.y = baseY // preserved; bob applied via scale below
      animal.rig.body.rotation.z = moving ? Math.sin(animal.phase) * 0.04 : 0
      // Grazing dip when idle, head bob when moving.
      animal.rig.head.rotation.x = moving
        ? Math.sin(animal.phase * 0.5) * 0.08
        : Math.sin(elapsed * 0.8 + animal.phase) * 0.22 - 0.12

      // --- bubble ----------------------------------------------------------
      if (animal.bubble) {
        animal.bubble.position.y = Math.sin(elapsed * 2 + animal.phase) * 0.07
        // Billboard so the product icon always faces the player.
        animal.bubble.quaternion.copy(camera.quaternion)
      }
    }
  }

  serialize() {
    return this.animals.map((a) => ({ id: a.def.id, t: a.timer, r: a.ready }))
  }

  deserialize(data: ReturnType<Pasture['serialize']> | undefined) {
    if (!Array.isArray(data)) return
    for (const entry of data) {
      const def = ANIMAL_BY_ID.get(entry.id)
      if (def) this.add(def, { timer: entry.t, ready: entry.r })
    }
  }
}

function randomPointInPasture() {
  // Square-root the radius so points spread evenly rather than clustering at
  // the centre.
  const a = Math.random() * Math.PI * 2
  const d = Math.sqrt(Math.random()) * (PASTURE_RADIUS - 1.2)
  return new THREE.Vector2(PASTURE_CENTRE.x + Math.cos(a) * d, PASTURE_CENTRE.z + Math.sin(a) * d)
}

function angleLerp(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

export type { Animal }
