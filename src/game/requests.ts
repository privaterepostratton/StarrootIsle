import { CROPS, CROP_BY_ID } from './crops'
import { RARITIES, type RarityId } from './mutations'
import { stackQualifies, heldFor } from './trading'
import type { Inventory } from './inventory'

/**
 * Neighbour requests — the half of the friendship loop the neighbours start.
 *
 * Everything else in the valley waits for the player: trade offers sit in a
 * panel until opened, gifts wait in a mailbox, dry crops wait to be watered.
 * That makes five characters who never once ask for anything, which is what
 * made them read as vending machines with faces.
 *
 * A request is pushed instead of pulled. It arrives with a toast, hangs a marker
 * over that neighbour's farm, pays roughly double what the same produce would
 * fetch — and expires. The deadline is the whole point: it is the one thing in
 * the game that asks the player to change today's plan.
 *
 * Deliberately scarce. One or two a day across five neighbours, never two at
 * once from the same person, because a permanent queue of chores is a job.
 */

export interface NeighbourRequest {
  id: string
  neighbourId: string
  /** Field names match TradeOffer so the stack-matching helpers are shared. */
  wantCropId: string
  wantCount: number
  wantRarity: RarityId
  coins: number
  seeds: { id: string; qty: number } | null
  friendship: number
  /** Seconds of play left before it lapses. */
  secondsLeft: number
  /** What it started at, so the UI can draw a fraction rather than guess. */
  totalSeconds: number
  fulfilled: boolean
}

/** How long a request stands. Roughly one in-game day at the default length. */
const LIFETIME_SECONDS = 210

/** Requests posted per day rollover. */
const PER_DAY = { min: 1, max: 2 }

/**
 * Pay well above a trade offer, which already pays above market.
 *
 * A favour asked under time pressure has to be worth interrupting a plan for,
 * or the correct play is to ignore every request and keep farming — and then
 * the whole system is a nag with no upside.
 */
const GENEROSITY = 2.4

function makeRequest(
  neighbourId: string,
  favourite: string,
  playerLevel: number,
  friendship: number,
  day: number,
  index: number,
  random: () => number,
): NeighbourRequest {
  const affordable = CROPS.filter((c) => c.unlockLevel <= playerLevel)
  const pool = affordable.length ? affordable : [CROPS[0]]

  // Bias toward their favourite, same as trade offers — a request should still
  // sound like the person making it.
  const favouriteDef = CROP_BY_ID.get(favourite)
  const useFavourite = favouriteDef && favouriteDef.unlockLevel <= playerLevel && random() < 0.55
  const want = useFavourite ? favouriteDef! : pool[Math.floor(random() * pool.length)]

  // Rarity demands only once they know you well enough to ask a real favour.
  const roll = random()
  let wantRarity: RarityId = 'common'
  if (friendship >= 50 && roll < 0.18) wantRarity = 'silver'

  const rarityMult = RARITIES.find((r) => r.id === wantRarity)?.multiplier ?? 1
  // Small counts on purpose: a request should be fillable from the barn or from
  // one quick harvest, not be a second job.
  const wantCount = wantRarity === 'common' ? 2 + Math.floor(random() * 4) : 1

  const marketValue = want.sellPrice * wantCount * rarityMult
  return {
    id: `${neighbourId}-req-${day}-${index}`,
    neighbourId,
    wantCropId: want.id,
    wantCount,
    wantRarity,
    coins: Math.round(marketValue * GENEROSITY * (1 + friendship / 200)),
    seeds: random() < 0.5 ? { id: want.id, qty: 2 + Math.floor(random() * 3) } : null,
    friendship: wantRarity === 'common' ? 7 : 12,
    secondsLeft: LIFETIME_SECONDS,
    totalSeconds: LIFETIME_SECONDS,
    fulfilled: false,
  }
}

export class Requests {
  /** Open requests, at most one per neighbour. */
  private open = new Map<string, NeighbourRequest>()
  private generatedDay = -1

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  requestFor(neighbourId: string) {
    const req = this.open.get(neighbourId)
    return req && !req.fulfilled ? req : null
  }

  get all() {
    return [...this.open.values()]
  }

  /** Requests still answerable: not filled, and not out of time. */
  get openCount() {
    return this.all.filter((r) => !r.fulfilled && r.secondsLeft > 0).length
  }

  /**
   * Post the day's requests. Returns the new ones so the caller can announce them.
   *
   * Neighbours who already owe an answer are skipped rather than queued: two
   * open asks from the same person is how a friendly favour turns into a
   * to-do list.
   */
  refresh(
    day: number,
    playerLevel: number,
    neighbours: { id: string; favourite: string; friendship: number }[],
    random: () => number = Math.random,
  ): NeighbourRequest[] {
    if (this.generatedDay === day || neighbours.length === 0) return []
    this.generatedDay = day

    // Fulfilled and lapsed requests clear on the rollover; live ones carry over.
    for (const [id, req] of [...this.open]) {
      if (req.fulfilled || req.secondsLeft <= 0) this.open.delete(id)
    }

    const free = neighbours.filter((n) => !this.open.has(n.id))
    const count = Math.min(
      free.length,
      PER_DAY.min + Math.floor(random() * (PER_DAY.max - PER_DAY.min + 1)),
    )

    const posted: NeighbourRequest[] = []
    for (let i = 0; i < count; i++) {
      const pick = free.splice(Math.floor(random() * free.length), 1)[0]
      if (!pick) break
      const req = makeRequest(pick.id, pick.favourite, playerLevel, pick.friendship, day, i, random)
      this.open.set(pick.id, req)
      posted.push(req)
    }
    if (posted.length > 0) this.emit()
    return posted
  }

  /** Tick deadlines. Returns any that lapsed this frame, for the caller to report. */
  update(dt: number): NeighbourRequest[] {
    const lapsed: NeighbourRequest[] = []
    for (const req of this.open.values()) {
      if (req.fulfilled || req.secondsLeft <= 0) continue
      req.secondsLeft -= dt
      if (req.secondsLeft <= 0) {
        req.secondsLeft = 0
        lapsed.push(req)
      }
    }
    if (lapsed.length > 0) this.emit()
    return lapsed
  }

  /** What the player is holding towards a request. */
  held(req: NeighbourRequest, inventory: Inventory) {
    return heldFor(inventory, req)
  }

  canFill(req: NeighbourRequest, inventory: Inventory) {
    return !req.fulfilled && req.secondsLeft > 0 && this.held(req, inventory) >= req.wantCount
  }

  /**
   * Hand the produce over and take the payment.
   *
   * Spends the cheapest qualifying stacks first, exactly as a trade does — a
   * request for three turnips must never quietly eat a rainbow one.
   */
  fulfil(req: NeighbourRequest, inventory: Inventory) {
    if (!this.canFill(req, inventory)) return false

    const candidates = [...inventory.produce.values()]
      .filter((s) => stackQualifies(s, req))
      .sort((a, b) => a.pricePerKg - b.pricePerKg)

    let remaining = req.wantCount
    for (const stack of candidates) {
      if (remaining <= 0) break
      const take = Math.min(stack.count, remaining)
      const share = stack.totalWeight * (take / stack.count)
      stack.count -= take
      stack.totalWeight -= share
      if (stack.count <= 0) inventory.produce.delete(stack.key)
      remaining -= take
    }

    inventory.coins += req.coins
    if (req.seeds) inventory.giveSeed(req.seeds.id, req.seeds.qty)
    req.fulfilled = true
    this.emit()
    return true
  }

  /** Human-readable summary of what is being asked for. */
  describe(req: NeighbourRequest) {
    const def = CROP_BY_ID.get(req.wantCropId)
    const rarity = RARITIES.find((r) => r.id === req.wantRarity)
    const prefix = req.wantRarity === 'common' ? '' : `${rarity?.emoji ?? ''} ${rarity?.name} `
    return `${req.wantCount}× ${prefix}${def?.name ?? req.wantCropId}`
  }

  /** Clear everything, for a retirement. */
  reset() {
    this.open.clear()
    this.generatedDay = -1
    this.emit()
  }

  serialize() {
    return { day: this.generatedDay, open: [...this.open.values()] }
  }

  deserialize(d: ReturnType<Requests['serialize']> | undefined) {
    if (!d) return
    this.generatedDay = Number.isFinite(d.day) ? d.day : -1
    this.open.clear()
    for (const req of d.open ?? []) {
      // A save can hold a request for a crop that no longer exists, and a
      // deadline is meaningless if the numbers came back malformed.
      if (!req || typeof req.neighbourId !== 'string') continue
      if (!CROP_BY_ID.has(req.wantCropId)) continue
      if (!Number.isFinite(req.secondsLeft)) continue
      this.open.set(req.neighbourId, req)
    }
    this.emit()
  }
}
