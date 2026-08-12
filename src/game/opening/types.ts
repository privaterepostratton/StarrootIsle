import * as THREE from 'three'

export type BeatId =
  | 'wake' | 'crate' | 'shovel' | 'clearing' | 'plant'
  | 'grow' | 'harvest' | 'arrival' | 'done'

export const BEAT_ORDER: BeatId[] = [
  'wake', 'crate', 'shovel', 'clearing', 'plant', 'grow', 'harvest', 'arrival', 'done',
]

/** The complete text budget. Nothing else renders during the opening. */
export const OPENING_STRINGS = {
  pull: 'Pull.',
  sand: "The sand won't take them.",
  clear: 'Clear.',
  dig: 'Dig.',
  plant: 'Plant.',
  pick: 'Pick.',
  wanted: 'It wanted something.',
  notYours: "You didn't plant this.",
} as const
export type OpeningStringKey = keyof typeof OPENING_STRINGS

/** Reserved. Luck only. Never in environment, markers, or ordinary VFX. */
export const LOTTO_GOLD = 0xf2c14e
/** Marker/pulse colour for opening guidance (warm ivory, NOT gold). */
export const PULSE_IVORY = 0xefe3c8

/** Per-frame world observation the sequencer advances on (Ftue pattern). */
export interface OpeningStats {
  satUp: boolean
  crateOpened: boolean
  shovelPulled: boolean
  requiredChaosLeft: number   // ChaosPocket.requiredLeft
  pocketCleared: boolean
  bedsDug: number
  seedsPlanted: number        // sun-tomato + mystery planted count
  tomatoesRipe: number
  ordinariesPicked: number
  oddPicked: boolean
  tidePicked: number
  goatDone: boolean
  journalDismissed: boolean
}

export type OpeningEvent =
  | 'sand-refused'            // refusal fired (metrics + string already shown)
  | 'voluntary-clear'         // extra chaos object cleared
  | 'mystery-planted'

/** A world object that accepts the hold gesture. */
export interface HoldTarget {
  id: string
  kind: 'shovel' | 'chaos' | 'dig' | 'odd-fruit'
  pos: THREE.Vector3
  radius: number              // world-units press-forgiveness around pos
  duration: number            // seconds of held press to complete
  verb: OpeningStringKey | null // prompt shown while candidate (max one on screen)
  onProgress?: (t: number) => void   // 0..1 while held
  onComplete: () => void
  onCancel?: () => void
}

export interface TideDrop {
  id: 'spiral-shell' | 'sea-glass' | 'driftwood-stick'
      | 'rope-coil' | 'odd-fruit' | 'impossible-glass'
  lotto: boolean              // true only for impossible-glass (session 2)
}

export interface FirstReturnPlan {
  mysteryBed: { x: number; z: number } | null  // farm tile coords, null if pocketed
  goatRevisit: boolean
}

export interface OpeningRecord {
  v: 1
  beat: BeatId | 'done'
  voluntaryCleared: number
  mysteryPlanted: boolean
  mysteryTile: { x: number; z: number } | null
  completedAt: number | null   // Date.now()
  firstReturnDone: boolean
}
