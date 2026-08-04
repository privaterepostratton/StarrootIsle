import * as THREE from 'three'
import { createPetModel, createEggModel, type PetRig } from '../assets/pet'
import { MINOR_LAYER, setLayer } from '../assets/style'

/**
 * Pets.
 *
 * Pets are the compounding layer: they never act directly, they bend the
 * numbers other systems already use. A Bunny does not plant anything — it
 * makes every crop on the farm grow faster, forever, while you do the same
 * things you were doing anyway.
 *
 * Every passive is expressed as a `PetBonuses` field, and the rest of the game
 * reads that aggregate rather than knowing what a Fox is. Adding a species is
 * a data change.
 */

export type PetSpeciesId = 'bunny' | 'chick' | 'fox' | 'hedgehog' | 'dragonling' | 'phoenix'
export type PetRarity = 'common' | 'rare' | 'legendary'

export interface PetSpecies {
  id: PetSpeciesId
  name: string
  emoji: string
  rarity: PetRarity
  blurb: string
  /** Per-level contribution to each bonus. Level 1 gets exactly this. */
  bonus: Partial<PetBonuses>
}

/** Aggregate of every equipped pet's passives. */
export interface PetBonuses {
  /** Multiplier on crop growth rate. 0.1 = +10% faster. */
  growth: number
  /** Added to rarity and mutation luck. */
  luck: number
  /** Chance a harvest yields double. */
  duplicate: number
  /** Chance per second to water a random dry plot. */
  autoWater: number
  /** Multiplier on rolled fruit weight. */
  weight: number
}

export const NO_BONUSES: PetBonuses = { growth: 0, luck: 0, duplicate: 0, autoWater: 0, weight: 0 }

export const PET_SPECIES: PetSpecies[] = [
  {
    id: 'bunny', name: 'Bunny', emoji: '🐰', rarity: 'common',
    // No defence on purpose: it is one of them, and a raid is a family reunion.
    blurb: 'Crops grow faster while it hops about. Useless against its own kind.',
    bonus: { growth: 0.06 },
  },
  {
    id: 'chick', name: 'Chick', emoji: '🐤', rarity: 'common',
    blurb: 'Scratches up luckier soil. Better rarity rolls, and it will squawk at a raider.',
    bonus: { luck: 0.1 },
  },
  {
    id: 'fox', name: 'Fox', emoji: '🦊', rarity: 'rare',
    blurb: 'Sometimes brings back a second one of whatever you picked.',
    bonus: { duplicate: 0.05, growth: 0.02 },
  },
  {
    id: 'hedgehog', name: 'Hedgehog', emoji: '🦔', rarity: 'rare',
    blurb: 'Snuffles around watering dry plots, and nobody wants to headbutt a hedgehog.',
    bonus: { autoWater: 0.05, weight: 0.06 },
  },
  {
    id: 'dragonling', name: 'Dragonling', emoji: '🐉', rarity: 'legendary',
    blurb: 'Its presence warps the odds — much luckier crops, and they come on faster.',
    bonus: { luck: 0.3, growth: 0.06 },
  },
  {
    id: 'phoenix', name: 'Phoenix', emoji: '🔥', rarity: 'legendary',
    blurb: 'Everything it watches over grows heavier and doubles more often. Raiders keep their distance.',
    bonus: { weight: 0.25, duplicate: 0.1 },
  },
]

export const PET_BY_ID = new Map(PET_SPECIES.map((p) => [p.id, p]))

export interface EggDef {
  id: string
  name: string
  emoji: string
  price: number
  /** Real seconds to hatch. */
  hatchSeconds: number
  unlockLevel: number
  shell: number
  speck: number
  /** Species odds, summing to 1. */
  odds: { species: PetSpeciesId; chance: number }[]
}

export const EGGS: EggDef[] = [
  {
    id: 'common', name: 'Common Egg', emoji: '🥚', price: 600, hatchSeconds: 120, unlockLevel: 3,
    shell: 0xf2e8d4, speck: 0xc4a878,
    odds: [
      { species: 'bunny', chance: 0.45 },
      { species: 'chick', chance: 0.45 },
      { species: 'fox', chance: 0.08 },
      { species: 'hedgehog', chance: 0.02 },
    ],
  },
  {
    id: 'rare', name: 'Rare Egg', emoji: '🐣', price: 3200, hatchSeconds: 300, unlockLevel: 7,
    shell: 0xc8dcf0, speck: 0x6a9cd0,
    odds: [
      { species: 'fox', chance: 0.42 },
      { species: 'hedgehog', chance: 0.42 },
      { species: 'bunny', chance: 0.08 },
      { species: 'dragonling', chance: 0.06 },
      { species: 'phoenix', chance: 0.02 },
    ],
  },
  {
    id: 'legendary', name: 'Legendary Egg', emoji: '🌟', price: 18000, hatchSeconds: 600, unlockLevel: 12,
    shell: 0xf0d8f0, speck: 0xc46ad0,
    odds: [
      { species: 'dragonling', chance: 0.45 },
      { species: 'phoenix', chance: 0.35 },
      { species: 'fox', chance: 0.1 },
      { species: 'hedgehog', chance: 0.1 },
    ],
  },
]

export const EGG_BY_ID = new Map(EGGS.map((e) => [e.id, e]))

/** How many pets can be out at once. */
export const MAX_EQUIPPED = 3

/** XP a pet needs to reach the next level. */
export function petXpToNext(level: number) {
  return Math.round(60 * Math.pow(level, 1.4))
}

export const PET_MAX_LEVEL = 15

export interface Pet {
  uid: string
  species: PetSpecies
  level: number
  xp: number
  equipped: boolean
  /** Live model, only built while equipped. */
  rig: PetRig | null
  /** Follow state. */
  pos: THREE.Vector2
  phase: number
  facing: number
}

export interface IncubatingEgg {
  uid: string
  def: EggDef
  /** Seconds left. */
  remaining: number
}

/** Distance a pet tries to keep from the player. */
const FOLLOW_DISTANCE = 1.5
const FOLLOW_SPEED = 6.2

export class Pets {
  readonly group = new THREE.Group()
  readonly owned: Pet[] = []
  readonly incubating: IncubatingEgg[] = []

  private uidCounter = 0
  private readonly listeners = new Set<() => void>()
  /** Accumulates fractional auto-water chance so low rates still fire. */
  private autoWaterAccum = 0

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private nextUid() {
    return `p${++this.uidCounter}`
  }

  get equipped() {
    return this.owned.filter((p) => p.equipped)
  }

  /**
   * Combined passives from every equipped pet, scaled by level.
   *
   * Level scaling is linear on the species' base value, so a level 10 Bunny is
   * worth ten level 1 Bunnies. That keeps a single well-fed pet competitive
   * with a roster of fresh ones, which is what makes levelling feel worth it.
   */
  bonuses(): PetBonuses {
    const total = { ...NO_BONUSES }
    for (const pet of this.equipped) {
      const scale = pet.level
      for (const key of Object.keys(total) as (keyof PetBonuses)[]) {
        total[key] += (pet.species.bonus[key] ?? 0) * scale
      }
    }
    return total
  }

  // --- eggs ---------------------------------------------------------------

  startIncubating(def: EggDef) {
    this.incubating.push({ uid: this.nextUid(), def, remaining: def.hatchSeconds })
    this.emit()
  }

  /** Eggs whose timer has run out and are waiting to be opened. */
  get readyEggs() {
    return this.incubating.filter((e) => e.remaining <= 0)
  }

  hatch(uid: string): Pet | null {
    const index = this.incubating.findIndex((e) => e.uid === uid)
    if (index < 0) return null
    const egg = this.incubating[index]
    if (egg.remaining > 0) return null
    this.incubating.splice(index, 1)

    // Weighted pick over the egg's odds table.
    let roll = Math.random()
    let speciesId = egg.def.odds[egg.def.odds.length - 1].species
    for (const entry of egg.def.odds) {
      roll -= entry.chance
      if (roll <= 0) {
        speciesId = entry.species
        break
      }
    }

    const pet: Pet = {
      uid: this.nextUid(),
      species: PET_BY_ID.get(speciesId)!,
      level: 1,
      xp: 0,
      equipped: false,
      rig: null,
      pos: new THREE.Vector2(),
      phase: Math.random() * 7,
      facing: 0,
    }
    this.owned.push(pet)

    // Auto-equip while there is room, so a first pet is immediately visible.
    if (this.equipped.length < MAX_EQUIPPED) this.setEquipped(pet, true)

    this.emit()
    return pet
  }

  // --- roster -------------------------------------------------------------

  setEquipped(pet: Pet, on: boolean) {
    if (on && this.equipped.length >= MAX_EQUIPPED && !pet.equipped) return false
    pet.equipped = on

    if (on && !pet.rig) {
      pet.rig = createPetModel(pet.species.id)
      setLayer(pet.rig.root, MINOR_LAYER)
      this.group.add(pet.rig.root)
    } else if (!on && pet.rig) {
      this.group.remove(pet.rig.root)
      pet.rig = null
    }

    this.emit()
    return true
  }

  /** Award XP to every equipped pet. Returns pets that levelled. */
  addXp(amount: number) {
    const levelled: Pet[] = []
    for (const pet of this.equipped) {
      if (pet.level >= PET_MAX_LEVEL) continue
      pet.xp += amount
      while (pet.level < PET_MAX_LEVEL && pet.xp >= petXpToNext(pet.level)) {
        pet.xp -= petXpToNext(pet.level)
        pet.level++
        levelled.push(pet)
      }
    }
    if (levelled.length) this.emit()
    return levelled
  }

  // --- per-frame ----------------------------------------------------------

  /**
   * Tick incubation and move the pets. `onAutoWater` fires when a hedgehog-ish
   * pet decides to water something; the caller owns what that means.
   */
  update(dt: number, elapsed: number, playerPos: THREE.Vector3, onAutoWater?: () => void) {
    let hatchedSomething = false
    for (const egg of this.incubating) {
      if (egg.remaining > 0) {
        egg.remaining = Math.max(0, egg.remaining - dt)
        if (egg.remaining === 0) hatchedSomething = true
      }
    }
    if (hatchedSomething) this.emit()

    const bonuses = this.bonuses()
    if (bonuses.autoWater > 0 && onAutoWater) {
      this.autoWaterAccum += bonuses.autoWater * dt
      while (this.autoWaterAccum >= 1) {
        this.autoWaterAccum -= 1
        onAutoWater()
      }
    }

    const equipped = this.equipped
    equipped.forEach((pet, i) => {
      if (!pet.rig) return

      // Fan out around the player so pets never stack into one blob.
      const angle = (i / Math.max(1, equipped.length)) * Math.PI * 2 + elapsed * 0.25
      const targetX = playerPos.x + Math.cos(angle) * FOLLOW_DISTANCE
      const targetZ = playerPos.z + Math.sin(angle) * FOLLOW_DISTANCE

      const dx = targetX - pet.pos.x
      const dz = targetZ - pet.pos.y
      const dist = Math.hypot(dx, dz)

      // Teleport if hopelessly far behind — happens on fast travel, and a pet
      // sprinting across the whole valley looks worse than a blink.
      if (dist > 26) {
        pet.pos.set(targetX, targetZ)
      } else if (dist > 0.12) {
        const step = Math.min(dist, FOLLOW_SPEED * dt * Math.min(1, dist / 2 + 0.25))
        pet.pos.x += (dx / dist) * step
        pet.pos.y += (dz / dist) * step
        pet.facing = angleLerp(pet.facing, Math.atan2(dx, dz), Math.min(1, dt * 10))
      }

      const moving = dist > 0.3
      pet.phase += dt * (moving ? 11 : 3)

      pet.rig.root.position.set(pet.pos.x, playerPos.y, pet.pos.y)
      pet.rig.root.rotation.y = pet.facing

      // Hop rather than walk — a bounce sells "small and cute" far better than
      // a leg cycle at this size.
      const hop = moving ? Math.abs(Math.sin(pet.phase)) * 0.1 : Math.sin(pet.phase * 0.5) * 0.012
      pet.rig.body.position.y = 0.18 + hop
      pet.rig.body.rotation.x = moving ? Math.sin(pet.phase) * 0.12 : 0
      pet.rig.head.rotation.z = Math.sin(pet.phase * 0.4) * 0.07

      for (let f = 0; f < pet.rig.flaps.length; f++) {
        pet.rig.flaps[f].rotation.x = Math.sin(pet.phase * 0.9 + f) * (moving ? 0.35 : 0.12)
      }
      for (let l = 0; l < pet.rig.legs.length; l++) {
        pet.rig.legs[l].rotation.x = moving ? Math.sin(pet.phase + l * Math.PI) * 0.5 : 0
      }
    })
  }

  // --- persistence --------------------------------------------------------

  serialize() {
    return {
      pets: this.owned.map((p) => ({
        uid: p.uid, species: p.species.id, level: p.level, xp: p.xp, equipped: p.equipped,
      })),
      eggs: this.incubating.map((e) => ({ uid: e.uid, def: e.def.id, remaining: e.remaining })),
      counter: this.uidCounter,
    }
  }

  deserialize(d: ReturnType<Pets['serialize']> | undefined) {
    if (!d) return
    this.uidCounter = d.counter ?? 0

    for (const entry of d.pets ?? []) {
      const species = PET_BY_ID.get(entry.species)
      if (!species) continue
      const pet: Pet = {
        uid: entry.uid,
        species,
        level: entry.level ?? 1,
        xp: entry.xp ?? 0,
        equipped: false,
        rig: null,
        pos: new THREE.Vector2(),
        phase: Math.random() * 7,
        facing: 0,
      }
      this.owned.push(pet)
      if (entry.equipped) this.setEquipped(pet, true)
    }

    for (const entry of d.eggs ?? []) {
      const def = EGG_BY_ID.get(entry.def)
      if (def) this.incubating.push({ uid: entry.uid, def, remaining: entry.remaining })
    }
    this.emit()
  }

  /** Advance incubation for time spent with the tab closed. */
  advanceOffline(seconds: number) {
    for (const egg of this.incubating) egg.remaining = Math.max(0, egg.remaining - seconds)
    this.emit()
  }
}

export { createEggModel }

function angleLerp(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
