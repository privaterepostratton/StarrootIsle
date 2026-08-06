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

// --- what makes one animal different from the next ---------------------------

/**
 * The grade of an individual, rolled once when it joins the paddock.
 *
 * Crops have rarity and mutations; livestock had nothing — every sheep was the
 * same sheep, so a paddock of twelve was one purchase decision made twelve
 * times. A grade turns each animal into a thing you own rather than a slot you
 * filled, and gives taming a lottery of its own: the free chicken you caught in
 * the woods can be the best bird on the farm.
 *
 * Ordered rarest-first and walked in order, the same way crop rarity rolls, so
 * the two systems read alike and neither can drift into its own conventions.
 */
export type AnimalGradeId = 'common' | 'fine' | 'prize' | 'champion' | 'legendary'

export interface AnimalGrade {
  id: AnimalGradeId
  name: string
  emoji: string
  /** Chance of rolling this or better. */
  chance: number
  /** Multiplies what its product sells for. */
  value: number
  /** Badge tint in the UI. */
  color: string
}

export const ANIMAL_GRADES: AnimalGrade[] = [
  { id: 'legendary', name: 'Legendary', emoji: '🌟', chance: 0.008, value: 10, color: '#ff7ae0' },
  { id: 'champion', name: 'Champion', emoji: '🏆', chance: 0.035, value: 4.5, color: '#f5c518' },
  { id: 'prize', name: 'Prize', emoji: '🎀', chance: 0.11, value: 2.2, color: '#7ae0ff' },
  { id: 'fine', name: 'Fine', emoji: '✦', chance: 0.3, value: 1.4, color: '#9ad86a' },
  { id: 'common', name: 'Common', emoji: '', chance: 1, value: 1, color: '#c9b48e' },
]

export const GRADE_BY_ID = new Map(ANIMAL_GRADES.map((g) => [g.id, g]))

/**
 * A quirk, independent of grade.
 *
 * Grade is how *good* an animal is; a trait is what it is *like*. Kept apart so
 * a common animal can still be interesting to own — a Common cow that fills
 * twice as fast is a different thing from a Prize cow that pays more, and a
 * player who has learned the difference is a player reading their paddock.
 */
export interface AnimalTrait {
  id: string
  name: string
  blurb: string
  /** Multiplies the wait between products. Under one is faster. */
  speed: number
  /** Multiplies what the product sells for. */
  value: number
}

export const ANIMAL_TRAITS: AnimalTrait[] = [
  { id: 'steady', name: 'Steady', blurb: 'Reliable, unremarkable, and never any trouble.', speed: 1, value: 1 },
  { id: 'earlyriser', name: 'Early Riser', blurb: 'Up before the farmer. Fills a third quicker.', speed: 0.68, value: 1 },
  { id: 'generous', name: 'Generous', blurb: 'Gives half again as much as it needs to.', speed: 1, value: 1.5 },
  { id: 'placid', name: 'Placid', blurb: 'Takes its time, and it shows in the quality.', speed: 1.25, value: 1.9 },
  { id: 'restless', name: 'Restless', blurb: 'Never settles. Quick to fill, quick to empty.', speed: 0.55, value: 0.75 },
  { id: 'pedigree', name: 'Pedigree', blurb: 'Bred for it. Faster and worth more.', speed: 0.85, value: 1.3 },
]

export const TRAIT_BY_ID = new Map(ANIMAL_TRAITS.map((t) => [t.id, t]))

/**
 * Names, so a paddock is a set of animals rather than a count of them.
 *
 * Deliberately homely: these are farm animals with farm names, and the joke of
 * a Legendary pig called Doris is doing more work than any adjective would.
 */
const NAMES = [
  'Daisy', 'Buttercup', 'Pip', 'Clover', 'Doris', 'Mabel', 'Nutmeg', 'Rosie',
  'Hazel', 'Poppy', 'Bramble', 'Willow', 'Maple', 'Pickle', 'Tuppence', 'Biscuit',
  'Marigold', 'Sorrel', 'Cinder', 'Juniper', 'Peaches', 'Waffle', 'Bumble', 'Fern',
]

/** What one collection from this animal is worth. */
export function productValue(animal: Animal) {
  return Math.max(1, Math.round(animal.def.product.value * animal.grade.value * animal.trait.value))
}

/** How long this animal takes to fill, in seconds. */
export function productInterval(animal: Animal) {
  return animal.def.interval * animal.trait.speed
}

/**
 * XP for one collection.
 *
 * Scaled by grade but not by trait: a better animal is a better animal, while a
 * fast one already earns more XP per hour by producing more often, and paying
 * it twice would make Restless the only trait worth keeping.
 */
export function productXp(animal: Animal) {
  return Math.max(1, Math.round(animal.def.xp * animal.grade.value))
}

/** What a collection hands back — the animal as well as the species. */
export interface AnimalHaul {
  def: AnimalDef
  animal: Animal
  value: number
  xp: number
}

export function rollAnimalGrade(luck = 1): AnimalGrade {
  for (const grade of ANIMAL_GRADES) {
    if (Math.random() < grade.chance * luck) return grade
  }
  return ANIMAL_GRADES[ANIMAL_GRADES.length - 1]
}

export function rollAnimalTrait(): AnimalTrait {
  return ANIMAL_TRAITS[Math.floor(Math.random() * ANIMAL_TRAITS.length)]
}

function rollName() {
  return NAMES[Math.floor(Math.random() * NAMES.length)]
}

/** Centre and radius of the fenced pasture the animals roam. Defined with the
 *  rest of the village layout and re-exported here for existing callers. */
export { PASTURE_CENTRE, PASTURE_RADIUS } from './village'
import { PASTURE_CENTRE, PASTURE_RADIUS } from './village'

export interface Animal {
  def: AnimalDef
  /** This one's own name. See NAMES. */
  name: string
  /** How good an example of its species it is. */
  grade: AnimalGrade
  /** What it is like, independent of how good it is. */
  trait: AnimalTrait
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

  add(
    def: AnimalDef,
    opts: {
      timer?: number
      ready?: boolean
      /** Restored from a save; rolled fresh when absent. */
      name?: string
      grade?: AnimalGrade
      trait?: AnimalTrait
    } = {},
  ) {
    const rig = createAnimalModel(def.id)
    this.group.add(rig.root)

    const pos = randomPointInPasture()
    const grade = opts.grade ?? rollAnimalGrade()
    const trait = opts.trait ?? rollAnimalTrait()
    const animal: Animal = {
      def,
      name: opts.name ?? rollName(),
      grade,
      trait,
      rig,
      pos,
      target: randomPointInPasture(),
      facing: Math.random() * Math.PI * 2,
      timer: opts.timer ?? def.interval * trait.speed,
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

  /**
   * Nearest animal of any kind within `maxDist` — what a click on the paddock
   * hits. Separate from `findReadyNear` because clicking one that is *not*
   * ready has to do something too: it opens its card.
   */
  findNear(point: THREE.Vector3, maxDist = 1.6): Animal | null {
    let best: Animal | null = null
    let bestDist = maxDist
    for (const animal of this.animals) {
      const d = Math.hypot(animal.pos.x - point.x, animal.pos.y - point.z)
      if (d < bestDist) {
        best = animal
        bestDist = d
      }
    }
    return best
  }

  /** Still in the paddock? A card left open on a sold animal must know. */
  has(animal: Animal) {
    return this.animals.includes(animal)
  }

  /** Collect from a specific animal. Returns what it produced. */
  collect(animal: Animal): AnimalHaul | null {
    if (!animal.ready) return null
    animal.ready = false
    animal.timer = productInterval(animal)
    this.hideBubble(animal)
    return { def: animal.def, animal, value: productValue(animal), xp: productXp(animal) }
  }

  /** Collect everything at once. Returns one entry per animal that gave. */
  collectAll(): AnimalHaul[] {
    const results: AnimalHaul[] = []
    for (const animal of this.animals) {
      if (!animal.ready) continue
      const haul = this.collect(animal)
      if (haul) results.push(haul)
    }
    return results
  }

  /** Every animal, for the paddock listing. */
  all(): readonly Animal[] {
    return this.animals
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
    return this.animals.map((a) => ({
      id: a.def.id,
      t: a.timer,
      r: a.ready,
      // Optional on the way back in, so a save written before animals had
      // names simply rolls them one — which is the same thing that happens the
      // first time any animal is bought.
      n: a.name,
      g: a.grade.id,
      tr: a.trait.id,
    }))
  }

  deserialize(data: ReturnType<Pasture['serialize']> | undefined) {
    if (!Array.isArray(data)) return
    for (const entry of data) {
      const def = ANIMAL_BY_ID.get(entry.id)
      if (!def) continue
      this.add(def, {
        timer: entry.t,
        ready: entry.r,
        name: entry.n,
        grade: GRADE_BY_ID.get(entry.g),
        trait: TRAIT_BY_ID.get(entry.tr),
      })
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

