import { CROPS } from './crops'
import { MUTATIONS, RARITIES } from './mutations'
import { PET_SPECIES } from './pets'
import { ANIMALS } from './animals'

/**
 * Discovery log.
 *
 * Records what the player has actually seen rather than what they own, because
 * the two diverge immediately — you sell produce, pets get released, but you
 * have still *found* a Rainbow Melon and that should stay on the record.
 *
 * Everything here is derived from tables that already exist, so a new crop or
 * mutation appears in the almanac automatically with no extra bookkeeping.
 */

export type DiscoveryKind = 'crops' | 'mutations' | 'rarities' | 'pets' | 'animals'

export interface CropRecord {
  /** Best sale value ever obtained from this crop, for bragging rights. */
  bestValue: number
  /** Heaviest single fruit, in kg. */
  heaviestKg: number
  /** Total ever harvested. */
  harvested: number
}

export class Discovery {
  readonly crops = new Map<string, CropRecord>()
  readonly mutations = new Set<string>()
  readonly rarities = new Set<string>()
  readonly pets = new Set<string>()
  readonly animals = new Set<string>()

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  /** True if this is the first time the player has seen any of it. */
  recordHarvest(
    cropId: string,
    amount: number,
    rarity: string,
    mutations: string[],
    value: number,
    heaviestKg: number,
  ) {
    let novel = false

    const existing = this.crops.get(cropId)
    if (!existing) {
      this.crops.set(cropId, { bestValue: value, heaviestKg, harvested: amount })
      novel = true
    } else {
      existing.harvested += amount
      if (value > existing.bestValue) existing.bestValue = value
      if (heaviestKg > existing.heaviestKg) existing.heaviestKg = heaviestKg
    }

    if (!this.rarities.has(rarity)) {
      this.rarities.add(rarity)
      novel = true
    }
    for (const id of mutations) {
      if (!this.mutations.has(id)) {
        this.mutations.add(id)
        novel = true
      }
    }

    this.emit()
    return novel
  }

  recordPet(speciesId: string) {
    const novel = !this.pets.has(speciesId)
    this.pets.add(speciesId)
    if (novel) this.emit()
    return novel
  }

  recordAnimal(id: string) {
    const novel = !this.animals.has(id)
    this.animals.add(id)
    if (novel) this.emit()
    return novel
  }

  has(kind: DiscoveryKind, id: string) {
    return kind === 'crops' ? this.crops.has(id) : this[kind].has(id)
  }

  cropRecord(id: string) {
    return this.crops.get(id) ?? null
  }

  /** Found / total for one category. */
  progress(kind: DiscoveryKind): [found: number, total: number] {
    switch (kind) {
      case 'crops':
        return [this.crops.size, CROPS.length]
      case 'mutations':
        return [this.mutations.size, MUTATIONS.length]
      case 'rarities':
        return [this.rarities.size, RARITIES.length]
      case 'pets':
        return [this.pets.size, PET_SPECIES.length]
      case 'animals':
        return [this.animals.size, ANIMALS.length]
    }
  }

  /** Overall completion, 0..1, weighting every entry equally. */
  get completion() {
    const kinds: DiscoveryKind[] = ['crops', 'mutations', 'rarities', 'pets', 'animals']
    let found = 0
    let total = 0
    for (const kind of kinds) {
      const [f, t] = this.progress(kind)
      found += f
      total += t
    }
    return total === 0 ? 0 : found / total
  }

  serialize() {
    return {
      crops: [...this.crops],
      mutations: [...this.mutations],
      rarities: [...this.rarities],
      pets: [...this.pets],
      animals: [...this.animals],
    }
  }

  deserialize(d: ReturnType<Discovery['serialize']> | undefined) {
    if (!d) return
    this.crops.clear()
    for (const [id, rec] of d.crops ?? []) {
      // Guard the numbers — a corrupted record must not surface NaN in the UI.
      this.crops.set(id, {
        bestValue: Number.isFinite(rec?.bestValue) ? rec.bestValue : 0,
        heaviestKg: Number.isFinite(rec?.heaviestKg) ? rec.heaviestKg : 0,
        harvested: Number.isFinite(rec?.harvested) ? rec.harvested : 0,
      })
    }
    this.mutations.clear()
    for (const id of d.mutations ?? []) this.mutations.add(id)
    this.rarities.clear()
    for (const id of d.rarities ?? []) this.rarities.add(id)
    this.pets.clear()
    for (const id of d.pets ?? []) this.pets.add(id)
    this.animals.clear()
    for (const id of d.animals ?? []) this.animals.add(id)
    this.emit()
  }
}
