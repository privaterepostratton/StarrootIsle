/**
 * The opening sequencer: beat state, advancement, and nothing else.
 *
 * Advance-by-observation, straight from the Ftue school (src/ui/ftue.ts): no
 * module ever calls "next beat". Every frame the integrator hands this class a
 * snapshot of the world (`OpeningStats`, built from module getters the way
 * `ftueStats` is), and the current beat's predicate decides whether the beat
 * is finished. A sequence the world can drive forward is a sequence the player
 * cannot click past without doing the thing — and a sequence that resumes
 * correctly after any refresh, because the predicates re-evaluate against
 * whatever state the autosave restored.
 *
 * Ownership split (§3.1): this class owns *which beat we are in* and the
 * persisted record; the integrator owns all *staging* — `onBeatStart(beat)`
 * constructs/reveals/points world systems, and is required to be idempotent so
 * that resume and `jumpTo` can replay the whole chain safely. The sequencer
 * replays that chain itself in the constructor (wake included, for a fresh
 * player), so main.ts wires callbacks and forgets.
 *
 * Deliberately dependency-light: types.ts and opening-save.ts only. No THREE,
 * no DOM, no engine — beat truth must be testable and boot-order-proof.
 */

import {
  BEAT_ORDER,
  type BeatId,
  type FirstReturnPlan,
  type OpeningEvent,
  type OpeningRecord,
  type OpeningStats,
} from './types'
import { freshOpeningRecord, loadOpening, markLegacyDone, saveOpening } from './opening-save'

/**
 * Beat-completion predicates (§2.2): "beat X is done when the world looks like
 * this". Keyed by the beat being *completed*, not the one being entered.
 *
 * Numbers are the contract's, not re-derived: 6 beds / 6 seeds because the
 * pouch holds Sun Tomato ×6 plus the mystery seed and the pocket clears room
 * for six; 6 ripe because a player who pocketed the mystery seed still ripens
 * six sun-tomatoes (five ordinary + the scripted odd one); 5 + odd on harvest
 * because the odd fruit is a hold-pick counted separately. The tideline runs
 * in parallel and never gates ('grow' watches ripeness, not `tidePicked`).
 */
const BEAT_DONE: Record<Exclude<BeatId, 'done'>, (s: OpeningStats) => boolean> = {
  wake: (s) => s.satUp,
  crate: (s) => s.crateOpened,
  shovel: (s) => s.shovelPulled,
  clearing: (s) => s.pocketCleared,
  plant: (s) => s.bedsDug >= 6 && s.seedsPlanted >= 6,
  grow: (s) => s.tomatoesRipe >= 6,
  harvest: (s) => s.ordinariesPicked >= 5 && s.oddPicked,
  arrival: (s) => s.goatDone && s.journalDismissed,
}

/** The §3.3 gap: a "return" is a return, not an alt-tab. Seconds. */
const FIRST_RETURN_GAP_S = 30 * 60

export class OpeningSequencer {
  private readonly onBeatStart: (beat: BeatId) => void
  private readonly onDone: () => void
  private readonly onFirstReturnStart: (plan: FirstReturnPlan) => void
  private readonly rec: OpeningRecord

  constructor(opts: {
    onBeatStart: (beat: BeatId) => void
    onDone: () => void
    onFirstReturnStart: (plan: FirstReturnPlan) => void
  }) {
    this.onBeatStart = opts.onBeatStart
    this.onDone = opts.onDone
    this.onFirstReturnStart = opts.onFirstReturnStart

    /*
     * Adopt the stored record or start fresh, then replay staging up to the
     * current beat — synchronously, here. A fresh player gets exactly one
     * `onBeatStart('wake')`; a mid-opening refresh gets the whole chain (each
     * staging function is idempotent by contract, and items the autosave
     * already granted are simply re-asserted). Doing this in the constructor
     * rather than lazily on the first update means the world is staged before
     * the first frame renders — the fade-from-white has no naked frame under it.
     *
     * A 'done' record constructs an inert sequencer (`active` false, no
     * callbacks fire): W-INT is expected to gate construction on `shouldRun`,
     * but building one anyway — say, to reach `beginFirstReturn` — is safe.
     */
    this.rec = loadOpening() ?? freshOpeningRecord()
    if (this.rec.beat !== 'done') this.replayThrough(this.rec.beat)
  }

  /**
   * The §3.2 decision table, boot-time, before construction:
   *
   * | stored record        | hasSave | result                                  |
   * |----------------------|---------|-----------------------------------------|
   * | none                 | false   | fresh player → run from 'wake'          |
   * | none                 | true    | legacy save → mark done, never run      |
   * | beat != 'done'       | any     | resume the opening                      |
   * | beat == 'done'       | any     | normal game                             |
   *
   * The legacy row *writes* (`markLegacyDone`) so the null-record case is
   * decided exactly once — every later boot takes the 'done' row. First-return
   * eligibility is not this method's business: that is `beginFirstReturn`,
   * called separately when this returns false.
   */
  static shouldRun(hasSave: boolean): boolean {
    const rec = loadOpening()
    if (rec) return rec.beat !== 'done'
    if (hasSave) {
      markLegacyDone()
      return false
    }
    return true
  }

  /** False once the opening has fully played out (beat === 'done'). */
  get active(): boolean {
    return this.rec.beat !== 'done'
  }

  get beat(): BeatId {
    return this.rec.beat
  }

  /** The live record — read-only by convention; mutate via notify/markers. */
  get record(): OpeningRecord {
    return this.rec
  }

  /**
   * Advance-by-observation. Call every frame while `active`.
   *
   * A `while` rather than an `if`: a resumed session (or a jump) can restore a
   * world several predicates ahead of the recorded beat — autosaved inventory
   * has the seeds planted, say, while the record still reads 'plant'. Chaining
   * catches the record up in one frame instead of one beat per frame, and each
   * skipped beat still gets its `onBeatStart` (staging is idempotent, and the
   * later beats depend on the earlier ones having staged).
   */
  update(_dt: number, stats: OpeningStats): void {
    while (this.rec.beat !== 'done' && BEAT_DONE[this.rec.beat](stats)) {
      this.enterBeat(BEAT_ORDER[BEAT_ORDER.indexOf(this.rec.beat) + 1])
    }
  }

  /**
   * Out-of-band events that live in the record but gate no beat. The optional
   * `detail` rides alongside `mystery-planted` so the record can remember
   * *which* tile the mystery seed went into — the session-2 plan needs the
   * coordinate, and the event alone cannot carry it. Callers that omit it get
   * `mysteryPlanted` without a tile (the return plan then treats the sprout
   * as untraceable and skips it, which only degrades, never crashes).
   */
  notify(event: OpeningEvent, detail?: { tile?: { x: number; z: number } }): void {
    switch (event) {
      case 'voluntary-clear':
        this.rec.voluntaryCleared++
        break
      case 'mystery-planted':
        this.rec.mysteryPlanted = true
        if (detail?.tile) this.rec.mysteryTile = { x: detail.tile.x, z: detail.tile.z }
        break
      case 'sand-refused':
        // Metrics-only today (the string and refusal anim already played at
        // the call site); recorded nowhere because the record schema has no
        // slot for it and the D0 funnel reads it from analytics, not the save.
        return
    }
    saveOpening(this.rec)
  }

  /**
   * Dev/test jump: land on `beat`, firing `onBeatStart` for every beat up to
   * and including the target so the world is fully staged (idempotent staging
   * makes replays safe). Jumping to 'done' plays the whole chain then runs the
   * normal completion path — the same handover a natural finish gets.
   */
  jumpTo(beat: BeatId): void {
    if (beat === 'done') {
      // Land on 'arrival' *before* replaying: staging reads `this.beat` to
      // decide replay-vs-live, and replaying the chain with the record still
      // on some earlier beat would stage that beat live (the wake cinematic,
      // for one) instead of snapping it.
      this.rec.beat = 'arrival'
      this.replayThrough('arrival')
      this.finish()
      return
    }
    this.rec.beat = beat
    saveOpening(this.rec)
    this.replayThrough(beat)
  }

  /**
   * Session-2 gate (§3.3). Called at boot when the opening is done but the
   * first return has not happened. All three conditions live here so main.ts
   * can call it unconditionally:
   *
   *  - opening complete (`beat === 'done'`) — a mid-opening refresh is a
   *    resume, not a return;
   *  - first return not already delivered;
   *  - offline gap >= 30 minutes — the return beats are a *reward for coming
   *    back*, and firing them after an accidental refresh spends the mystery
   *    sprout's one reveal on a non-moment.
   *
   * Returns the staging plan (and fires `onFirstReturnStart` with it), or null
   * if any condition fails. `mysteryBed` is the recorded tile only when the
   * seed was actually planted; `goatRevisit` flags the record-side eligibility
   * — the integrator still gates the actual visit on tomatoes growing, which
   * is world state this class deliberately cannot see.
   */
  beginFirstReturn(offlineSeconds: number): FirstReturnPlan | null {
    if (this.rec.beat !== 'done') return null
    if (this.rec.firstReturnDone) return null
    if (offlineSeconds < FIRST_RETURN_GAP_S) return null
    const plan: FirstReturnPlan = {
      mysteryBed: this.rec.mysteryPlanted ? this.rec.mysteryTile : null,
      goatRevisit: true,
    }
    this.onFirstReturnStart(plan)
    return plan
  }

  /** All return beats resolved (or session ended): never offer them again. */
  markFirstReturnDone(): void {
    this.rec.firstReturnDone = true
    saveOpening(this.rec)
  }

  /** Advance into `next`, persist, stage — or finish if `next` is 'done'. */
  private enterBeat(next: BeatId): void {
    if (next === 'done') {
      this.finish()
      return
    }
    this.rec.beat = next
    saveOpening(this.rec)
    this.onBeatStart(next)
  }

  /** Fire `onBeatStart` for every beat from 'wake' through `target`. */
  private replayThrough(target: BeatId): void {
    for (const b of BEAT_ORDER) {
      if (b === 'done') break
      this.onBeatStart(b)
      if (b === target) break
    }
  }

  /** The one exit: record done + completedAt, persist, hand the game over. */
  private finish(): void {
    if (this.rec.beat === 'done') return
    this.rec.beat = 'done'
    this.rec.completedAt = Date.now()
    saveOpening(this.rec)
    this.onDone()
  }
}
