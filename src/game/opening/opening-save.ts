/**
 * Opening persistence: the sequencer's record, under its own localStorage key.
 *
 * Deliberately NOT inside Save's blob. The opening record answers one boot-time
 * question — "does this device still owe the player the opening?" — and that
 * question has to be answerable before, and independently of, the world save.
 * A corrupt or wiped farm save must not re-run the opening for a veteran, and
 * a mid-opening autosave must not drag beat state through Save's serializer
 * (which other workers own). Same reasoning as the FTUE's `sv-ftue` key, and
 * the same coupling obligation: the `?new` wipe path calls `forgetOpening()`
 * exactly as it calls `forgetFtue()`.
 *
 * Every accessor is storage-fault tolerant (private browsing, storage off):
 * reads degrade to null, writes degrade to no-ops. The sequencer keeps its
 * authoritative record in memory, so a device without storage still plays the
 * opening correctly — it just replays it next boot, which is the least-bad
 * failure.
 */

import { BEAT_ORDER, type OpeningRecord } from './types'

/** The one storage key. Never inside Save's blob. */
export const OPENING_KEY = 'isle-opening-v1'

/** A fresh record: opening owed, nothing done. Exported for the sequencer. */
export function freshOpeningRecord(): OpeningRecord {
  return {
    v: 1,
    beat: 'wake',
    voluntaryCleared: 0,
    mysteryPlanted: false,
    mysteryTile: null,
    completedAt: null,
    firstReturnDone: false,
  }
}

/**
 * Read the stored record, or null if absent/corrupt.
 *
 * Corruption maps to null rather than a repaired partial record on purpose:
 * null means "fresh player" in the §3.2 decision table, and re-running the
 * opening is a far smaller wrong than resuming into an invented beat. Every
 * field is validated — a record with an unknown beat (say, from a future
 * schema) is treated as absent rather than crashing beat lookup.
 */
export function loadOpening(): OpeningRecord | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(OPENING_KEY)
  } catch {
    /* storage off */
  }
  if (!raw) return null
  try {
    const rec = JSON.parse(raw) as Partial<OpeningRecord>
    if (rec.v !== 1) return null
    if (typeof rec.beat !== 'string' || !BEAT_ORDER.includes(rec.beat)) return null
    return {
      v: 1,
      beat: rec.beat,
      voluntaryCleared: typeof rec.voluntaryCleared === 'number' ? rec.voluntaryCleared : 0,
      mysteryPlanted: rec.mysteryPlanted === true,
      mysteryTile:
        rec.mysteryTile && typeof rec.mysteryTile.x === 'number' && typeof rec.mysteryTile.z === 'number'
          ? { x: rec.mysteryTile.x, z: rec.mysteryTile.z }
          : null,
      completedAt: typeof rec.completedAt === 'number' ? rec.completedAt : null,
      firstReturnDone: rec.firstReturnDone === true,
    }
  } catch {
    return null
  }
}

/** Persist the record. Called on every beat change and counter mutation. */
export function saveOpening(rec: OpeningRecord): void {
  try {
    localStorage.setItem(OPENING_KEY, JSON.stringify(rec))
  } catch {
    /* storage off — the in-memory record carries the session */
  }
}

/**
 * Erase the record entirely — the `?new` wipe path (W-INT calls this beside
 * `forgetFtue()`), so a wiped save replays the opening from wake.
 */
export function forgetOpening(): void {
  try {
    localStorage.removeItem(OPENING_KEY)
  } catch {
    /* storage off */
  }
}

/**
 * Stamp a pre-update save as having "done" the opening it never saw.
 *
 * A veteran whose farm predates the opening must never wake on the beach —
 * their existing farm explains itself (the FTUE makes the same call for the
 * same reason). `firstReturnDone` is set too: the session-2 return is the
 * opening's epilogue, and a player who skipped act one gets no epilogue —
 * a mystery sprout appearing in a three-year-old farm would read as a bug.
 * `completedAt` records "now" so any future gap arithmetic stays sane.
 */
export function markLegacyDone(): void {
  const rec = freshOpeningRecord()
  rec.beat = 'done'
  rec.completedAt = Date.now()
  rec.firstReturnDone = true
  saveOpening(rec)
}
