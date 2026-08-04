import { CROPS } from './crops'
import { unlockLevelFor } from './progression'

/**
 * Seed shop stock.
 *
 * The shop does not carry everything, all the time. It carries a random subset
 * in limited quantity, and restocks on a timer. That single change is what
 * turns the shop from a vending machine into a reason to come back — you check
 * the restock because the good seed might be there, and buy it because it
 * might not be next time.
 */

/** Real seconds between restocks. */
export const RESTOCK_SECONDS = 180

interface StockEntry {
  cropId: string
  remaining: number
}

export class Stock {
  private entries = new Map<string, StockEntry>()
  timer = RESTOCK_SECONDS

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  /** Total seed packets on the shelf, across every crop. */
  get totalItems() {
    let n = 0
    for (const e of this.entries.values()) n += e.remaining
    return n
  }

  countOf(cropId: string) {
    return this.entries.get(cropId)?.remaining ?? 0
  }

  take(cropId: string, qty: number) {
    const entry = this.entries.get(cropId)
    if (!entry || entry.remaining < qty) return false
    entry.remaining -= qty
    this.emit()
    return true
  }

  /** Return reserved stock to the shelf when a purchase falls through. */
  restore(cropId: string, qty: number) {
    const entry = this.entries.get(cropId)
    if (entry) entry.remaining += qty
    else this.entries.set(cropId, { cropId, remaining: qty })
    this.emit()
  }

  /**
   * Catch the restock timer up after real time passed with the loop stopped.
   *
   * Only one restock is applied no matter how long you were away — the stall
   * has whatever it has now, and simulating a hundred missed deliveries would
   * just be a slow path to the same single fresh shelf.
   */
  advanceOffline(seconds: number, playerLevel = 1) {
    if (seconds >= this.timer) this.restock(playerLevel)
    else this.timer -= seconds
  }

  /**
   * Roll a new shelf.
   *
   * Cheaper seeds appear more often and in bulk; the top tier is rare and
   * comes in ones and twos, so seeing Dragonfruit in stock is an event. Stock
   * is capped to what the player has actually unlocked, otherwise the shelf
   * fills with rows they cannot buy.
   */
  restock(playerLevel: number) {
    this.entries.clear()
    this.timer = RESTOCK_SECONDS

    const available = CROPS.filter((c) => playerLevel >= unlockLevelFor(c.id))

    for (const crop of available) {
      const tier = CROPS.indexOf(crop)
      // Odds fall off with tier; the first two crops are always present so the
      // player can never be locked out of farming entirely.
      const chance = tier <= 1 ? 1 : Math.max(0.16, 0.92 - tier * 0.13)
      if (Math.random() > chance) continue

      const maxQty = tier <= 1 ? 22 : tier <= 3 ? 12 : tier <= 5 ? 6 : 3
      const qty = 1 + Math.floor(Math.random() * maxQty)
      this.entries.set(crop.id, { cropId: crop.id, remaining: qty })
    }

    this.emit()
  }

  /** Returns true on the frame a restock happens. */
  update(dt: number, playerLevel: number) {
    this.timer -= dt
    if (this.timer > 0) return false
    this.restock(playerLevel)
    return true
  }

  serialize() {
    return { entries: [...this.entries.values()], timer: this.timer }
  }

  deserialize(d: ReturnType<Stock['serialize']> | undefined) {
    if (!d) return
    this.entries.clear()
    for (const entry of d.entries ?? []) this.entries.set(entry.cropId, entry)
    this.timer = d.timer ?? RESTOCK_SECONDS
    this.emit()
  }
}
