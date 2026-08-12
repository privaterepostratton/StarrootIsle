# OPENING-CONTRACT.md — Isle Opening implementation contract

*Implementation contract for rebuilding session one per `docs/ISLE-OPENING-SPEC.md`.
Built by parallel workers with **no coordination and no git**. File ownership is strictly
disjoint: a worker may ONLY create/edit files in their ownership row. All cross-module
calls compile against the API signatures written here — do not read another worker's
files, do not change these signatures. If a signature is wrong for you, adapt on your
side of the boundary.*

*Coordinates are world-space (Y-up, XZ ground). Key anchors, verified in source:
`SPAWN = (-56, 0, 6)` (village.ts:270), `PLAYER_SLOT = (-32, 0)` / `FARM_CENTRE`
(village.ts:220-260), water level `-0.9`, ocean to the WEST (-x), sand band roughly
x ∈ [-70, -45] on the west arc.*

---

## 0. Governing rules (restated as build constraints)

1. **Tap = discrete act. Hold = shaping.** All shaping verbs (pull shovel, clear chaos,
   dig bed, pick the odd fruit) go through the new `HoldInput` system. Tap never shapes.
2. **Refusal, never failure.** Nothing during the opening can cost, expire, or punish.
   The sand-planting attempt plays a full try-and-refuse animation, string #2, no penalty.
3. **Text budget: exactly 8 strings**, defined once in `types.ts` as `OPENING_STRINGS`.
   No other user-facing text may render while the opening is active — no toasts, no
   popups, no tips, no cineTitle, no banners. The integrator gates every channel.
4. **Lotto gold `#F2C14E` (0xf2c14e) means luck only.** Exported as `LOTTO_GOLD` in
   types.ts. Used ONLY by: the odd tomato's streaks/shimmer, the lotto-tell VFX, the
   session-2 impossible sea-glass. The opening's soft-pulse markers, trails, and all
   other glows must NOT be gold (use warm ivory `#EFE3C8` / `0xefe3c8`). The existing
   FTUE gold rings/trails (0xffd062) are simply never shown during the opening.
   The existing rarity gold tint `0xf5c518` in mutations.ts is unified to `0xf2c14e`.
5. **UI born contextually; screen naked at wake.** `body.isle-opening` hides all
   `.hud-chrome`; opening UI elements are created by `OpeningUi` only when their beat
   births them. **No currency display, no XP, no level, no banners** — the opening
   grants zero coins and zero XP (materials/produce go to inventory silently).
6. **The string table (verbatim, complete):**

   | key | string | trigger |
   |---|---|---|
   | `pull` | `Pull.` | shovel hold prompt |
   | `sand` | `The sand won't take them.` | plant/dig attempt on sand |
   | `clear` | `Clear.` | first chaos object |
   | `dig` | `Dig.` | first bed |
   | `plant` | `Plant.` | first seed |
   | `pick` | `Pick.` | first tide-line item |
   | `wanted` | `It wanted something.` | journal after goat |
   | `notYours` | `You didn't plant this.` | mystery sprout, session 2 |

---

## 1. DESIGN MAPPING — spec beat → systems

| Beat | Reused | Replaced | New |
|---|---|---|---|
| **1 Wake** | Camera rig (`engine.focus/pitch/yaw`, `setCinematicDistance`); dt loop; player model (`loadFarmerModel`) | Old boot camera drop-in | Wake choreography in `OpeningSequencer` (fade-from-white div, lying pose = procedural root rotation, sit-up on first tap); 20s no-input nudge (wave splash + gull SFX); pinned dawn (`day.time = (7.2/24)*DAY_LENGTH`, one `day.apply()`, no `day.update`, `postfx.setNightAmount(0)`, weather held clear) |
| **2 Crate** | `storeCrate`-style prop pattern; `Inventory.giveSeed`; doober arc idea (but pouch fly-to is DOM) | `BeachSeeds` walk-over barrels (not constructed for opening players; marked emptied at handover) | `BeachProps` crate (procedural two-mesh, cobalt `#4A6FA5`, lid-open anim); Sun Tomato ×6 + 1 mystery seed; `OpeningUi.bornSatchel()` — first UI element |
| **3 Shovel** | `createShovelModel` (character.ts:54) restyled olive-wood/iron; Player procedural IK overlay (swing weights pattern) for the strain pose | — | First hold gesture via `HoldInput`; `Player`-independent strain lean driven by `setStrain(t)` extension **called from opening code via the existing playAction/tool API only** (see FARM/INT notes); sand-sluff burst; tern startle |
| **4 Refusal** | `isSand(x,z)` (terrain.ts:567); refusal precedent (barn-full refusal grammar) | — | Refuse animation (dig → sand pours back, `puff` burst in sand tones), string `sand`; `Butterflies` wayfinding actors leading SPAWN → treeline gap; bougainvillea magenta `#D14D8B` props at gap |
| **5 Clearing (CORE)** | `Clearing`'s per-object Group + `Obstacle{off}` pattern; `DEBRIS`/`MATERIALS` drop economy (fibre/wood/stone); `Bursts.emit`; `Doobers.spawn('produce', …)` for payout arcs | **Coin-gated tree felling** (`CLEAR_COST`, `fellTree`, chop timer) → gone for new players; old `Clearing` fellables removed via `clearing.restoreOpened()` at boot (surround trees kept as the jungle wall) | `ChaosPocket` — 7 chaos types, hold-to-clear, gate-free, at the farm pad; +4 voluntary extras (metric `voluntaryCleared`); pocket-clear fires **island's breath** VFX + music layer 2 |
| **6 Dig & plant** | `Farm` tiles, `plotTrayPlacement`, crop pipeline, `sproutBeds` rise anim | `openClearing()`'s instant 4-bed placement → `openBare()` + six `digBedAt()` holds | New crop `sun-tomato` (growSeconds 30 → 90 s real); mystery seed = crop `mystery-sprout` (dormant this session); **sundial ring** UI (`OpeningUi.sundial`) |
| **7 Tide line** | `Flotsam.findSpot` seaward-edge logic (pattern only); walk-over/tap grammar | `Flotsam` timer stays dormant (re-gated `farm.exists && !opening.active`) | `Tideline` — 3 scripted washups (shell, sea-glass, driftwood) on the wet-sand band near SPAWN; string `pick` |
| **8 First harvest / first roll** | `Farm.harvest`, rarity system (`mutations.ts` gold), `createSparkle` for shimmer, bloom (threshold 0.8 catches additive gold), `Bursts` spark kind | Organic-only rarity gate (`mutationsUnlocked`) → `plantScripted(tile, 'sun-tomato', 'gold')` scripts one odd plant | **Lotto tell** (`lottoTell()` export): gold shimmer burst + 0.3 s slow-mo (global dt multiplier at main.ts frame) + lotto chime (audio unaffected by slow-mo — correct); odd fruit is a **hold**-pick, ordinaries tap-pick |
| **9 Arrival** | Arrival-shot camera machinery (`pendingShot`/letterbox pattern, `modalOpen()` input freeze, `setCinematicDistance`) — but NO title text | `wildlife.onEmerge` "A wild X appears" flow (wildlife suppressed during opening) | `GoatArrival` — procedural hero goat (cream + sea-foam swirl), scripted: rustle → emerge → walk → sniff → **eat one tomato (plant remains)** → look-at-player 1 s → bleat → bound away; then `OpeningUi.showJournal('goat')` + string `wanted`; sit-and-sketch pose |
| **First return** | Save timestamps (`Save.offlineSeconds`); Tideline; GoatArrival | — | `OpeningSequencer.beginFirstReturn()`: mystery sprout emerged-strange (tap → string `notYours`, hold to… nothing yet — never auto-revealed), 3 new washups incl. small-lotto impossible sea-glass (lotto tell, small), goat revisit if tomatoes growing + coat-tuft collectable → journal |

---

## 2. MODULE PLAN — strict file ownership

**Rule: one file, one worker. Nobody but W-INT touches `src/main.ts`. Nobody touches
`src/ui/ftue.ts`, `src/game/world.ts`, `src/game/village.ts`, `src/game/vegetation.ts`,
`src/game/wildlife.ts`, `src/game/clearing.ts`, `src/game/beach-seeds.ts`,
`src/game/flotsam.ts`, `src/game/save.ts`, `index.html`, or `src/ui/styles.css` at all.**

W-INT writes `src/game/opening/types.ts` **first** (it is committed to disk before any
other worker starts; its content is fully specified in §2.1 so workers can also just
transcribe it locally if they start early).

| # | Worker | NEW files owned | EXISTING files owned (edits) |
|---|---|---|---|
| W-INT | Integrator | `src/game/opening/types.ts` | `src/main.ts` |
| W-SEQ | Sequencer | `src/game/opening/sequencer.ts`, `src/game/opening/opening-save.ts` | — |
| W-INPUT | Hold input | `src/game/opening/hold-input.ts` | `src/ui/touch.ts` (additive: `onHoldStart/Move/End` callbacks only), `src/game/player.ts` (additive: `setStrain`, `playOpeningPose` — see §5.2) |
| W-CHAOS | Chaos pocket | `src/game/opening/chaos-pocket.ts`, `src/assets/opening/chaos-props.ts` | — |
| W-BEACH | Beach props | `src/game/opening/beach-props.ts`, `src/game/opening/tideline.ts`, `src/assets/opening/beach-models.ts` | — |
| W-FARM | Farm/crops | `src/assets/opening/mystery-sprout.ts` | `src/game/farm.ts` (additive API §2.6), `src/game/crops.ts` (2 new defs), `src/game/mutations.ts` (gold tint → 0xf2c14e), the economy test file (exempt new crops) |
| W-GOAT | Fauna | `src/game/opening/goat.ts`, `src/game/opening/butterflies.ts`, `src/assets/opening/goat-model.ts` | — |
| W-UI | Opening UI | `src/ui/opening/opening-ui.ts` (injects its own `<style>`; **no styles.css edits**) | `src/ui/layout/keys.ts` (add `'isle-opening'` + `'born'` to `VOLATILE`) |
| W-AV | Audio/VFX | `src/game/opening/music.ts`, `src/assets/opening/vfx.ts`, new files under `public/sfx/` and `public/audio/` | `src/core/audio.ts` (additive: extend `Sfx` union + `SFX_SAMPLES`; add `get ctx(): AudioContext \| null` and `get musicBus(): GainNode`) |
| W-ART | Palette | retinted `public/textures/sand.png` (overwrite; keep a `sand-orig.png` copy beside it) | `src/game/terrain.ts` (`C_SAND` → `0xefe3c8` only), `src/game/water.ts` (colour uniforms only) |

All new gameplay modules import THREE, `types.ts`, and existing exported helpers
(`groundHeight`, `isSand`, `isWalkable` from `game/terrain`; `SPAWN`, `FARM_CENTRE`,
`PLAYER_SLOT` from `game/village`; `getModels`, `modelGroup`, `PROP_HEIGHT` from
`assets/models`; `mat/ball/cyl/block` from `assets/style`). Importing existing modules
is always allowed; *editing* them is ownership-bound.

### 2.1 `src/game/opening/types.ts` (W-INT, written first — exact content contract)

```ts
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
```

### 2.2 `src/game/opening/sequencer.ts` + `opening-save.ts` (W-SEQ)

```ts
// opening-save.ts — own localStorage key, NEVER inside Save's blob
export const OPENING_KEY = 'isle-opening-v1'
export function loadOpening(): OpeningRecord | null
export function saveOpening(rec: OpeningRecord): void
export function forgetOpening(): void            // W-INT calls in the ?new wipe path
export function markLegacyDone(): void           // pre-update saves skip the opening

// sequencer.ts
export class OpeningSequencer {
  constructor(opts: {
    onBeatStart: (beat: BeatId) => void   // W-INT stages world/UI per beat here
    onDone: () => void                    // handover (§4.3)
    onFirstReturnStart: (plan: FirstReturnPlan) => void
  })
  /** true → run the opening. Decision table in §3.2. */
  static shouldRun(hasSave: boolean): boolean
  readonly active: boolean                 // false once beat === 'done'
  readonly beat: BeatId
  readonly record: OpeningRecord
  /** Advance-by-observation. Call every frame while active. */
  update(dt: number, stats: OpeningStats): void
  /** Out-of-band events (refusal fired, voluntary clear, mystery planted). */
  notify(event: OpeningEvent): void
  /** Dev/test: jump; onBeatStart fires for every beat up to and incl. target,
   *  each staging function is idempotent so replays are safe. */
  jumpTo(beat: BeatId): void
  /** Called at boot when record.beat === 'done' && !firstReturnDone &&
   *  offline gap >= 30 min. Returns null if conditions unmet. */
  beginFirstReturn(offlineSeconds: number): FirstReturnPlan | null
  markFirstReturnDone(): void
}
```

Beat-completion predicates (internal, advance on `stats`):
`wake`→ `satUp` · `crate`→ `crateOpened` · `shovel`→ `shovelPulled` ·
`clearing`→ `pocketCleared` · `plant`→ `bedsDug >= 6 && seedsPlanted >= 6` ·
`grow`→ `tomatoesRipe >= 6` (tideline runs in parallel, never gates) ·
`harvest`→ `ordinariesPicked >= 5 && oddPicked` · `arrival`→ `goatDone && journalDismissed`
→ `done`. Persist `record` on every beat change (autosaves during the opening are fine:
granted items live in the normal save; beat staging is idempotent on resume).

### 2.3 `src/game/opening/hold-input.ts` (W-INPUT) + `src/ui/touch.ts` edits

```ts
export class HoldInput {
  /** touch may be null until TouchControls exists; call attachTouch later. */
  constructor(engine: Engine)
  attachTouch(touch: TouchControls): void
  enabled: boolean                       // W-INT gates by beat
  setTargets(targets: HoldTarget[]): void
  readonly candidate: HoldTarget | null  // nearest in-radius target (drives prompt)
  readonly holding: HoldTarget | null
  readonly progress: number              // 0..1
  /** Fires when a press ends before hold-commit and no target consumed it —
   *  W-INT routes this to the tap path (interactAt / opening tap logic). */
  onTapFallthrough?: (clientX: number, clientY: number) => void
  update(dt: number, playerPos: THREE.Vector3): void
  dispose(): void
}
```

Mechanics: HoldInput installs its own capture-phase `pointerdown/up` listeners on the
canvas for mouse. On press it resolves a target via `pickGround`/`rayDistanceToPoint`
against `setTargets` positions (world-radius forgiveness). Hold commits at
`HOLD_COMMIT = 0.35 s` of stationary press (≤ 22 px travel), then `progress` climbs
over `target.duration`; early release → `onCancel` + degrade to tap. When enabled it
`stopPropagation()`s so the legacy `pointerdown → interactAt` in main.ts never sees
opening presses. **touch.ts additive edit:** three optional public fields on
`TouchControls` — `onHoldStart?: (x: number, y: number) => boolean` (return `true` to
claim the finger: joystick/look roles are released for that pointer, mirroring
`beginPinch`'s role-dropping), `onHoldMove?: (x: number, y: number) => void`,
`onHoldEnd?: (commit: boolean) => void`. Detection: finger stationary within
`TAP_SLOP` past 350 ms (safely under nothing — `TAP_MS = 480` already refuses to call
such a touch a tap). No other behaviour of touch.ts may change.

### 2.4 `src/game/opening/chaos-pocket.ts` + `src/assets/opening/chaos-props.ts` (W-CHAOS)

```ts
// chaos-props.ts — all procedural (style.ts helpers); no GLBs
export type ChaosKind =
  | 'vine' | 'frond' | 'driftwood' | 'morning-glory' | 'basket' | 'stone' | 'amphora'
export interface ChaosPropRig {
  root: THREE.Group
  setStrain(t: number): void   // 0..1 elastic deform while held
  playClear(): void            // snap/crack/crush exit anim, ~0.4 s then hide
}
export function createChaosProp(kind: ChaosKind, variant: number): ChaosPropRig

// chaos-pocket.ts
export interface ChaosDrop {
  material: 'wood' | 'fiber' | 'stone' | null
  amount: number
  keepable: 'amphora-shard' | 'spiral-shell' | null
}
export class ChaosPocket {
  constructor(scene: THREE.Group, obstacles: Obstacle[], rng: () => number)
  readonly centre: THREE.Vector3          // ≈ (-34, y, 0), see §4.1
  readonly requiredLeft: number
  readonly cleared: boolean               // all REQUIRED objects gone
  readonly voluntaryCleared: number       // the thesis metric
  /** Hold targets for every standing hold-clearable object (kind 'chaos'). */
  holdTargets(): HoldTarget[]
  /** Amphora shard is tap-collect: returns collectable near pos or null. */
  tapTargetNear(pos: THREE.Vector3): { id: string; collect: () => ChaosDrop } | null
  onClear?: (at: THREE.Vector3, kind: ChaosKind, drop: ChaosDrop, voluntary: boolean) => void
  onPocketCleared?: (centre: THREE.Vector3) => void
  update(dt: number, elapsed: number): void
  /** Idempotent staging for resume/jumpTo: instantly remove cleared state. */
  restore(state: { cleared: boolean }): void
}
```

Layout: required pocket ~6×4 units centred `(-34, 0)` (inside the farm pad flat zone,
mouth facing the sea at -x): 3 vine tangles, 2 fronds, 1 driftwood branch,
1 morning-glory mat, 1 basket (drops fiber + spiral shell), 2 half-sunk basalt stones,
1 amphora shard (tap). Plus 4 voluntary extras (2 vines, 2 fronds) at the pocket edges
outside the required footprint. Hold durations: vine 1.1 s, frond 0.5 s, driftwood 0.9 s,
mat 1.0 s, basket 0.8 s, stone 1.3 s. Each prop gets `Obstacle{off}` in the shared
array (set `off = true` on clear; never splice). Drops: per spec table (fibre/wood×2/stone).
Colours: basalt `0x2a2622` + white crust; terracotta `0xc4693b`; NO gold anywhere.

### 2.5 `src/game/opening/beach-props.ts` + `tideline.ts` + `src/assets/opening/beach-models.ts` (W-BEACH)

```ts
// beach-models.ts — procedural
export function createOpeningCrate(): { root: THREE.Group; openLid: () => void }
  // sun-bleached wood, flaking cobalt 0x4a6fa5, rope handles, hinged lid
export function createSeedPouch(): THREE.Group      // linen 0xe8decc, tomato stamp
export function createOpeningShovel(): THREE.Group  // olive-wood grip, iron blade, rust
export function createWashupProp(id: TideDrop['id']): THREE.Group
export function createJournalProp(): THREE.Group    // for the sit-and-sketch beat

// beach-props.ts
export class BeachProps {
  constructor(scene: THREE.Group, obstacles: Obstacle[])
  readonly cratePos: THREE.Vector3    // (-54.5, y, 8.5)
  readonly shovelPos: THREE.Vector3   // (-49, y, 3.5)
  readonly crateOpened: boolean
  readonly shovelPulled: boolean
  /** Tap handler; opens if player within 2.2u of crate. Returns handled. */
  tapCrate(playerPos: THREE.Vector3): boolean
  /** kind 'shovel', duration 1.4 s, verb 'pull'; null once pulled. */
  shovelHoldTarget(): HoldTarget | null
  onCrateOpened?: (pouchWorldPos: THREE.Vector3) => void  // W-INT: grant seeds + bornSatchel
  onShovelPulled?: (at: THREE.Vector3) => void            // W-INT: player gets tool, tern startle
  update(dt: number, elapsed: number): void
  restore(state: { crate: boolean; shovel: boolean }): void
}

// tideline.ts
export class Tideline {
  constructor(scene: THREE.Group, rng: () => number)
  /** set 1 = shell/sea-glass/driftwood; set 2 = rope-coil/odd-fruit/impossible-glass. */
  spawnSet(set: 1 | 2): void
  readonly remaining: number
  /** Tap-collect within 1.8u. */
  targetNear(pos: THREE.Vector3): { id: string; at: THREE.Vector3; collect: () => TideDrop } | null
  positions(): THREE.Vector3[]        // for pulse markers / session-2 glints
  onCollect?: (at: THREE.Vector3, drop: TideDrop) => void
  update(dt: number, elapsed: number, playerPos: THREE.Vector3): void
  clear(): void
}
```

Washup anchors: computed at construction by marching seaward from
`(-58, 2)`, `(-57, 9)`, `(-60, -3)` until `heightAt ≈ WATER_LEVEL + 0.25` and `isSand`
(the wet-band caramel look itself is a small conforming decal quad per anchor, tinted
`0xc9a97a` — terrain vertices are baked and must not be edited).

### 2.6 `src/game/farm.ts` additive API + crops (W-FARM)

New public members on `Farm` (all additive; existing behaviour untouched):

```ts
/** Farm exists (level 1) with ZERO plots placed. Idempotent. */
openBare(): void
/** Place one bed at the free grid cell nearest worldPos, rise animation,
 *  EXEMPT from the level plot-cap during the opening. Returns the tile or null. */
digBedAt(worldPos: THREE.Vector3): FarmTile | null
/** Plant bypassing shop/seed/unlock/mutation gates, with forced rarity. */
plantScripted(tile: FarmTile, cropId: string, rarity: 'common' | 'gold'): void
/** Public wrapper over the private model refresh (re-tint after rarity set). */
refreshTile(tile: FarmTile): void
/** World position of a tile's centre (for goat pathing / sundial rings). */
tileWorldPos(tile: FarmTile): THREE.Vector3
```

`src/game/crops.ts`: append `{ id: 'sun-tomato', form: 'bush', fruit: 'ribbed',
growSeconds: 30, harvests: 1, yield: 1, … }` (30 × GROW_TIME_SCALE 3 = **90 s real**,
unwatered; the opening never waters) and `{ id: 'mystery-sprout', … growSeconds: 9999 }`
(dormant; model from `src/assets/opening/mystery-sprout.ts`:
`createMysterySprout(state: 'dormant' | 'emerged'): THREE.Group` — taller, wrong-coloured,
unopened bud, faint pulse). Both crops carry a flag or are exempted by id in the economy
test (they are unpurchasable: `seedCost: 0`, excluded from shop stock by never being in
stock tables — verify stock derives from unlockLevel; if not, set `unlockLevel: 999`).
`src/game/mutations.ts`: change gold tint `0xf5c518` → `0xf2c14e` (one constant).

### 2.7 `src/game/opening/goat.ts` + `butterflies.ts` + `src/assets/opening/goat-model.ts` (W-GOAT)

```ts
// goat-model.ts — procedural hero (style.ts box-rig school, like animal.ts but bespoke)
export interface GoatRig {
  root: THREE.Group
  head: THREE.Group; body: THREE.Group; legs: THREE.Group[]; ears: THREE.Group[]; tail: THREE.Group
  lookAt(worldPos: THREE.Vector3 | null): void   // head+ears track; null releases
}
export function createGoatModel(): GoatRig
  // cream 0xf1e9d8 coat, ONE sea-foam swirl 0x9fd8cf marking, small horns

// goat.ts
export type GoatPhase =
  | 'idle' | 'rustle' | 'emerge' | 'walk' | 'sniff' | 'eat' | 'look' | 'bleat' | 'bound' | 'done'
export class GoatArrival {
  constructor(scene: THREE.Group)
  /** Scripted beat-9 run. bedPositions from farm.tileWorldPos. */
  begin(bedPositions: THREE.Vector3[], playerPos: () => THREE.Vector3): void
  /** Session-2 revisit; leaves a coat tuft prop at the treeline on exit. */
  beginReturnVisit(bedPositions: THREE.Vector3[], playerPos: () => THREE.Vector3): void
  readonly phase: GoatPhase
  readonly done: boolean
  /** Camera focus while phase !== 'idle'/'done' (W-INT drives the shot). */
  focusPoint(): THREE.Vector3 | null
  onRustle?: (at: THREE.Vector3) => void      // audio-first anticipation
  onEat?: (bedPos: THREE.Vector3) => void     // plant REMAINS (no farm mutation)
  onLook?: () => void                          // the 1 s being-seen moment
  onDone?: (leftTuft: boolean) => void
  tuftTargetNear(pos: THREE.Vector3): { collect: () => void } | null  // session 2
  update(dt: number, elapsed: number): void
}

// butterflies.ts — the wayfinding actors (instanced quads, flutter pathing)
export class Butterflies {
  constructor(scene: THREE.Group)
  /** Two butterflies loop a drifting path from `from` toward `to`; ignorable. */
  lead(from: THREE.Vector3, to: THREE.Vector3): void
  hide(): void
  update(dt: number, elapsed: number): void
}
```

Goat emerges from the treeline behind the pocket at `(-26, -7)`, walks to the nearest
bed, timings: rustle 2.0 s → emerge 2.5 s → walk → sniff 1.2 s → eat 2.0 s → look 1.0 s
(hard 1 s, `lookAt(playerPos())`) → bleat 0.6 s → bound out. All animation is
transform-based (crab/pasture school: leg swing, head dip, body bob) — no GLB, no mixer,
which sidesteps the Meshy emissive/clip traps entirely.

### 2.8 `src/ui/opening/opening-ui.ts` (W-UI)

```ts
export class OpeningUi {
  constructor(engine: Engine)   // injects <style id="isle-opening-css">, creates DOM in #ui
  begin(): void                 // document.body.classList.add('isle-opening')
  end(): void                   // staged HUD rebirth: remove class, fade chrome in over 1.2 s
  /** Satchel corner slot born with a fly-to animation from a world point. */
  bornSatchel(fromWorld: THREE.Vector3): void
  /** THE one contextual prompt: soft ivory pulse circle (world-projected) +
   *  one-word verb. Passing null hides. Max one on screen — enforced here. */
  setPrompt(key: OpeningStringKey | null, worldPos?: THREE.Vector3): void
  /** Standalone soft-pulse marker (crate/shovel/washups). Ivory, never gold. */
  pulseAt(worldPos: THREE.Vector3 | null, radius?: number): void
  /** Sundial ring per bed; t 0..1; call each frame per planted bed. */
  sundial(bedKey: string, worldPos: THREE.Vector3, t: number): void
  clearSundial(bedKey: string): void
  seedChip(count: number | null): void            // visible during planting only
  blipMaterial(kind: 'wood' | 'fiber' | 'stone' | 'keepable', n: number): void
  blipHarvest(n: number): void
  /** Beat-9 journal page: goat sketch (inline SVG art) + empty want-slot +
   *  string 'wanted'. Tap anywhere dismisses. */
  showJournal(onDismiss: () => void): void
  readonly journalOpen: boolean
  update(dt: number): void      // projects world-anchored elements via engine.camera
}
```

CSS contract: `body.isle-opening .hud-chrome { opacity: 0; pointer-events: none; }`
(same shape as `panel-open`), plus a `#menuBtn` exception at `opacity: .4` per spec
UI element 9 (settings glyph present, 40 %). All opening DOM carries class `.isle-el`,
which the injected sheet styles; nothing depends on styles.css. keys.ts edit: add
`'isle-opening'` to `VOLATILE`.

### 2.9 `src/game/opening/music.ts` + `src/assets/opening/vfx.ts` + audio (W-AV)

```ts
// music.ts — three phase-locked stems (AudioBufferSourceNodes on Audio's ctx,
// started at the same ctx.currentTime; rain-bed pattern, NOT HTMLAudioElements)
export class OpeningMusic {
  constructor(audio: Audio)     // uses audio.ctx + audio.musicBus (new getters)
  start(): void                 // decode public/audio/opening-l1/l2/l3.mp3, L1 gain up
  enterLayer(n: 2 | 3): void    // 2 = pocket cleared (mandolin), 3 = first harvest
  fadeToGameMusic(): void       // stems out over 3 s, normal soundtrack resumes
}

// vfx.ts — THE TWO PERMANENT GRAMMAR EXPORTS (reused by the whole game forever)
/** "The island approves": soft golden-GREEN motes (0xbfd98a→0xe8e4b0, additive,
 *  fog:false) rising off an area. NOT lotto gold. */
export function createIslandBreath(area: { centre: THREE.Vector3; w: number; d: number }): {
  object: THREE.Object3D
  start(): void; stop(): void
  update(dt: number, elapsed: number): void
}
/** The lotto tell: LOTTO_GOLD shimmer burst + chime + 0.3 s slow-mo request.
 *  `slowMo` is W-INT's global dt-scale hook. `small` = session-2 sea-glass scale. */
export function playLottoTell(opts: {
  at: THREE.Vector3; bursts: Bursts; audio: Audio
  slowMo: (seconds: number, scale: number) => void; small?: boolean
}): void
/** Persistent odd-fruit shimmer (wraps createSparkle(LOTTO_GOLD)). */
export function createOddShimmer(): { object: THREE.Group; update(t: number): void }
```

`src/core/audio.ts` additive edits: extend `Sfx` with
`'shovel-pull' | 'vine-snap' | 'frond-sweep' | 'wood-crack' | 'basket-crunch' |
'stone-pry' | 'amphora-chime' | 'dig-thunk' | 'seed-plop' | 'tomato-pluck' |
'lotto-chime' | 'goat-bleat' | 'treeline-rustle' | 'crate-creak' | 'pouch-rustle' |
'charcoal' | 'gull' | 'wave-nudge'` + `SFX_SAMPLES` mappings; files generated to
`public/sfx/` via the elevenlabs-sfx skill (synth fallback covers any missing file).
Note the gesture gate: audio is silent until the first tap — the wake tap doubles as
the unlock, so `OpeningMusic.start()` is called from the beat-1 completion, not boot.

---

## 3. OPENING SEQUENCER DESIGN

### 3.1 Ownership and control flow

`OpeningSequencer` (W-SEQ) owns beat state + persistence. **W-INT owns all staging**:
`onBeatStart(beat)` in main.ts constructs/reveals/points systems per beat (idempotent —
`jumpTo`/resume replays them). Every frame while `opening.active`, main.ts builds
`OpeningStats` from module getters (mirror of `ftueStats` at main.ts:3157) and calls
`sequencer.update(dt, stats)` — advance-by-observation, the proven Ftue pattern, no
module ever calls "next beat".

Input gating: `modalOpen()` gains one term — `|| openingCinematic` (a W-INT boolean set
during beat-1 wake, the goat shot, and the journal). Between cinematics the player moves
freely; `HoldInput.enabled` and the per-beat `setTargets` calls are W-INT staging.
While `opening.active`, main.ts routes canvas taps to opening logic first
(crate → beds → tideline → chaos amphora → tap-to-move via `player.moveTo(nearestWalkable(...))`)
and never into the legacy `interactAt` farm chain; `HoldInput.onTapFallthrough` is that
router's entry point. Desktop parity: tap-to-move is enabled during the opening only.

### 3.2 Persistence / who runs the opening

Decision table at boot (in main.ts, after `Save.load()`):

| `loadOpening()` | `saved` | Result |
|---|---|---|
| null | null | fresh player → run opening from 'wake' |
| null | exists | legacy save → `markLegacyDone()`, normal game |
| record, beat != done | any | resume opening at record.beat (staging idempotent) |
| record done, firstReturnDone false | exists | normal game + `beginFirstReturn(offlineSeconds)` if gap ≥ 30 min |
| record done, firstReturnDone true | exists | normal game |

`?new` wipe path (main.ts:101-120) gains `forgetOpening()` — same coupling the file-top
comment demands for FTUE keys. The old FTUE never runs for opening players: W-INT
constructs `new Ftue(false, sfx)` always, and on opening completion writes the FTUE
store key to 'done' via a tiny local helper (localStorage `'sv-ftue'` = `'done'`) so
the coach never wakes later; the upgrade tour (its own key) still fires normally
post-opening — that is intended.

Items granted per beat persist through normal autosaves (inventory/farm are already
serialized); the sequencer record is the only extra state. Mid-opening refresh resumes
the beat with world staging rebuilt by replaying `onBeatStart` up the chain.

### 3.3 First return (session 2)

`beginFirstReturn` fires `onFirstReturnStart(plan)`; W-INT staging: (1) if
`plan.mysteryBed`, W-FARM's mystery crop is set to 'emerged' via
`plantScripted`/`refreshTile` + a tap on it shows string `notYours` (opening UI prompt,
one-shot; hold does nothing — never auto-revealed); (2) `tideline.spawnSet(2)` with a
world-space glint marker (`OpeningUi.pulseAt`) and `playLottoTell({small: true})` on
collecting the impossible glass; (3) if any sun-tomato is growing,
`goat.beginReturnVisit(...)` on a 60–120 s delay; tuft collect → journal page slot fills.
`markFirstReturnDone()` after all three resolve or at session end.

---

## 4. SCENE PLAN

### 4.1 Geography (real coordinates)

All on the existing west-arc beach; no terrain edits, no new heightfield.

| Thing | Position | Notes |
|---|---|---|
| Wake spot | `SPAWN (-56, 0, 6)` | lying pose, camera low, sea behind (-x), jungle above (+x) |
| Crate | `(-54.5, 8.5)` | 3 u from spawn, half-buried tilt, ivory pulse |
| Shovel | `(-49, 3.5)` | ~10 steps inland, 30° buried |
| Tide-line anchors ×3 | seaward march from `(-58, 2)`, `(-57, 9)`, `(-60, -3)` to `h ≈ -0.65` | wet-band decals `0xc9a97a` |
| Treeline gap + bougainvillea | `(-40, 0)` ± 4 on z | at the grass line; only magenta on screen |
| Chaos pocket | 6×4 centred `(-34, 0)` | inside the farm flat pad; voluntary extras on its rim |
| Farm beds | `Farm(FARM_CENTRE)` grid, six `digBedAt` near pocket centre | real farm tiles → free save/restore |
| Goat emerge | `(-26, -7)` | Clearing's surround wood is the treeline |
| Butterfly route | `(-52, 5)` → `(-40, 0)` | beat 4 |

The chaos pocket sits **on the farm pad** so cleared ground = future farm: after
`ChaosPocket.onPocketCleared`, `farm.openBare()` runs and beds dug are real `Farm`
tiles (rendering, growth, harvest, serialization all free).

### 4.2 Suppressed during the opening (all W-INT gates in main.ts)

- **HUD:** `body.isle-opening` (all chrome hidden; settings glyph 40 %).
- **Old opening systems:** `clearing.restoreOpened()` at boot (removes the 4 coin-gated
  fellables silently — verified it does not fire `onOpened` — keeps the 90 surround
  trees as the jungle wall); `BeachSeeds` constructed but immediately
  `restoreEmptied()`; `Flotsam.update` gate becomes `farm.exists && !opening.active`.
- **Guidance:** old Ftue inert (§3.2); `Tips.enabled = false` while active;
  `guidePath.setTargets([])` and `ftueRings.set([])` forced empty; FTUE pointer never
  shown.
- **Text channels:** `hud.toast`, `popups.spawn`, `eventBanner`, `levelUp` all no-op
  behind `if (opening.active) return` guards at their main.ts call sites; #cineTitle
  never written.
- **World life:** `wildlife.update` and `hood.update`/arrival shots skipped;
  shopkeeper/farmgirl greeters idle; `requests.postRequests` deferred; quests silent.
  Crabs (`critters`) stay — spec ambient fauna.
- **Time/weather/grade:** `day.time = (7.2 / 24) * DAY_LENGTH; day.apply(engine)` once;
  `day.update`/`weather.update`/`audio.setHour` skipped; `postfx.setNightAmount(0)`.
- **Economy displays:** no coins/XP granted, no doobers of kind 'coin'/'xp'; material
  payouts use doobers kind 'produce' + `OpeningUi.blipMaterial` (credit on
  `doobers.onCollect` so the blip lands with the arc).
- **Village geometry stays built** (it is 25+ units east and behind the camera's
  default up-the-cross framing); only its *systems* sleep.

### 4.3 Handover after beat 9 (`onDone`)

In order, in main.ts: `openingUi.end()` (staged chrome rebirth) → `sequencer` records
`done` + `completedAt` → day/weather/audio.setHour resume from hour 7.2 → wildlife,
flotsam (gate now passes), hood, tips, prompts, toasts re-enable → FTUE key marked done
→ `OpeningMusic.fadeToGameMusic()` → `HoldInput.enabled = false` (post-opening game
keeps its existing tap/key language; hold verbs return when the expansion gate ships).
Player state at handover: farm level 1 with 6 beds (5 harvested-regrown/spent +
1 mystery), 5 sun tomatoes + 1 gold tomato in produce, wood/fiber/stone materials,
spiral shell + amphora shard keepables (materials map), journal flag set. The normal
game loop (shop arrives via progression, upgrade tour, quests) proceeds untouched.

---

## 5. ART & AUDIO PLAN

### 5.1 Palette application (spec table → owners)

| Spec role | Value | Where | Owner |
|---|---|---|---|
| Dry sand ivory | `#EFE3C8` | `public/textures/sand.png` retint + `C_SAND = 0xefe3c8` (terrain.ts:48). Keep vertex R−B ≥ 0.15 so the shader sandW gate holds; author slightly desaturated — postfx multiplies saturation 1.2 | W-ART |
| Wet sand caramel | `#C9A97A` | Tideline decal quads (not terrain) | W-BEACH |
| Shallows / deep | `#3EC8C0` / `#1B6FA8` | `uShallowColor`/`uDeepColor` uniforms (water.ts:291-299) | W-ART |
| Jungle greens | `#2E6B3A→#8FCF6B` | Chaos props + bougainvillea foliage only (global vegetation retint is out of scope for D0 — flagged) | W-CHAOS |
| Volcanic rock | `#2A2622` + salt crust | basalt chaos stones | W-CHAOS |
| Culture blue | `#4A6FA5` | crate paint | W-BEACH |
| Terracotta | `#C4693B` | amphora shard | W-CHAOS |
| Linen | `#E8DECC` | pouch, journal, UI paper tones | W-BEACH / W-UI |
| Magenta | `#D14D8B` | bougainvillea at gap ONLY | W-GOAT? no — W-CHAOS (gap dressing ships with the pocket) |
| Lotto gold | `#F2C14E` | `LOTTO_GOLD` only: odd-fruit streaks/shimmer, lotto tell, impossible glass; mutations.ts tint unified | W-AV / W-FARM |

### 5.2 Models: reused vs procedural-new

- **Reused as-is:** farmer GLB (avatar), farm plot trays + crop pipeline, ribbed-tomato
  fruit factory (`sun-tomato` reuses `fruit: 'ribbed'` → authored tomato truss when
  ripe), crab critters, surround trees (jungle wall), palms, water/terrain.
- **Procedural-new (no GLBs, no Meshy — avoids emissive/clip/slim traps entirely):**
  hero goat (box-rig school), all 7 chaos types, crate + lid, seed pouch, opening
  shovel (restyle of `createShovelModel`), tide washups, journal + charcoal, mystery
  sprout, butterflies, bougainvillea spill.
- **Avatar animation:** locomotion clips reused (idle/walk/run); the loaded-but-unused
  `pick` clip covers kneel/pick beats; hold-strain, sit-up, and sit-and-sketch are
  procedural overlays in the existing IK/blend system (the swing/pour precedent).
  W-INT is the only main.ts toucher, but the Player-side `setStrain(t)` extension
  lives in `src/game/player.ts` — **assign player.ts to W-INPUT** (it is the hold
  system's output surface; no other worker edits it):
  `setStrain(t: number): void` (0..1 two-hand brace pose via existing blend weights) and
  `playOpeningPose(kind: 'lie' | 'situp' | 'sketch'): void` (transform-level poses).

### 5.3 SFX & music

24 spec SFX → 18 new `Sfx` ids (§2.9) + 6 already exist (`collect`, `pop`, `rare`,
footsteps, ambient waves). Generate with the elevenlabs-sfx skill into `public/sfx/`;
the synth fallback keeps missing files non-fatal. **Lotto chime is the only new sound
allowed to pair with LOTTO_GOLD** and nothing else may play it.

Music: three new stem files `public/audio/opening-l1.mp3` (uke/slack-key + waves),
`-l2.mp3` (mandolin/bouzouki layer), `-l3.mp3` (full warm theme layer), authored to a
common length/tempo so looped `AudioBufferSourceNode`s started at the same
`ctx.currentTime` stay phase-locked (rain-bed pattern; NOT HTMLAudioElement — those
drift). L1 at wake-tap, L2 gain-up on `onPocketCleared` (lands WITH island's breath),
L3 on first ordinary pick. Existing lagoon tracks resume at handover.

### 5.4 The two permanent grammar VFX (reusable exports, W-AV)

- **Island's breath** (`createIslandBreath`) — golden-GREEN rising motes (pollen-field
  school: additive, `fog: false`, rises ~0.14 u/s). Not gold. Post-opening callers:
  future blessing moments.
- **Lotto tell** (`playLottoTell`) — LOTTO_GOLD spark burst (`kind: 'spark'`,
  colors `[0xf2c14e, 0xfff8d0]`) + `lotto-chime` + `slowMo(0.3, 0.25)`. The slow-mo
  hook is W-INT's global dt multiplier applied immediately after `engine.tick()`
  (one line; audio runs real-time — chime plays full speed over slowed visuals, per
  spec). Post-opening callers: every rarity roll, egg hatch, tide rarity — forever.

---

## 6. VERIFY PLAN

Dev server: port **5216**. Tools: `scripts/cdp.mjs`, `window.__cap(opts)` (headless
JPEG frame), `scripts/shot.mjs`. Browser pane cannot screenshot hidden — use the cdp
pipeline (project memory: growagardentwo-dev-tools).

**Debug hook (W-INT, DEV-only, beside `window.game`):**

```ts
window.__isle = {
  beat: () => sequencer.beat,
  stats: () => currentOpeningStats,
  goto: (b: BeatId) => sequencer.jumpTo(b),   // idempotent staging replays
  ff: (s = 90) => farmFastForward(s),         // adds s seconds of crop progress
                                              // (crop.progress += s/growSecondsFor)
  hold: (id: string) => completeHoldById(id), // programmatic hold-commit
  tap: (x: number, z: number) => simulateWorldTap(x, z),
  goat: () => goat.begin(...),                // force beat-9 sequence
  ret: () => sequencer.beginFirstReturn(9e9), // force first-return staging
  record: () => sequencer.record,
}
```

**Per-beat headless checks** (a `scripts/verify-opening.mjs` driving cdp against
`http://localhost:5216/?new`):

| Beat | Drive | Assert (state via `__isle.stats()` / screenshot via `__cap`) |
|---|---|---|
| 1 | load `?new`, `__cap` | screen naked (no `.hud-chrome` visible), lying pose; dispatch canvas tap → `satUp` |
| 2 | `__isle.tap(-54.5, 8.5)` after moveTo | `crateOpened`, inventory has 6 sun-tomato + 1 mystery seed, satchel DOM exists |
| 3 | `__isle.hold('shovel')` | `shovelPulled`, shovel in hand frame |
| 4 | `__isle.tap` on sand with seeds | stats event log shows `sand-refused`; screenshot shows string #2; butterflies visible |
| 5 | `__isle.hold(...)` × required ids | `requiredLeft` decrements; `pocketCleared`; island's breath in frame; `voluntaryCleared` counts extras |
| 6 | 6 × `__isle.hold('dig')` + taps | `bedsDug === 6`, `seedsPlanted === 6`, sundial rings in frame |
| 7 | walk + taps at tideline anchors | `tidePicked === 3` |
| 8 | `__isle.ff(90)` then picks | 5 tap-picks + 1 hold-pick; `oddPicked`; screenshot within slow-mo window shows gold burst; assert NO other gold pixels pre-beat-8 (colour-scan the beat-1–7 contact sheet for `#F2C14E` ± tolerance) |
| 9 | `__isle.goto('arrival')` or natural | `goatDone`; journal page screenshot; `record().beat === 'done'` after dismiss |
| return | reload (no `?new`), `__isle.ret()` | mystery sprout emerged; set-2 washups; goat revisit when growing |
| regression | seed a legacy save, reload | opening skipped (`markLegacyDone`), normal HUD boots |
| resume | `?new` → advance to beat 5 → reload | resumes at beat 5 with pocket state restored |

String-budget lint: verify-opening greps a full-session DOM text dump for any rendered
string not in `OPENING_STRINGS` (toasts/popups/tips leaking = failure).

---

## 7. RISKS (from recon — carried into the build)

1. **main.ts is a 3325-line flat orchestrator** — all wiring lands in one file owned by
   W-INT; the fresh-vs-saved boot branch is shared, so every gate must be behind
   `opening.active` checks, and the legacy-save table (§3.2) must be regression-tested.
2. **No hold gesture exists anywhere**; mouse commits on pointerdown, touch on pointerup.
   HoldInput must unify tap timing across devices or they feel different. Left-half
   touch holds collide with the joystick role reservation (touch.ts:125-135) — the
   claim/release contract in §2.3 is the mitigation.
3. **Autosaves run during the opening** (beforeunload/10 s/visibility): granted items
   persist mid-sequence. Beat staging MUST be idempotent; the opening record is the
   single source of beat truth; clearing/crate state is re-derivable from it.
4. **Old economy/FTUE couplings**: `?new` must call `forgetOpening()`; FTUE key must be
   marked done at completion or the coach wakes later; `keepFtuePossible()` rescues and
   'Clearing the Canopy' quest reference the coin-gated clearing — both are dead paths
   for opening players but must not crash (W-INT guards).
5. **Reserved-gold collisions**: near-gold defaults saturate the codebase (sparkle
   0xfff0a0, FTUE rings 0xffd062, rarity tint 0xf5c518, warm dawn sky). Mitigations:
   rings/trails never shown, sparkle only via `createOddShimmer`, rarity tint unified,
   and the automated colour-scan in §6. The 1.2-saturation grade + warm dawn will push
   hues — verify gold reads distinct on screenshots at hour 7.2.
6. **Terrain is baked** — no runtime heightfield/vertex edits; wet band, loam, and soil
   rings are conforming decals/props; beach is not flat, so decals must conform or stay
   small.
7. **Economy tests enforce the crop curve** — `sun-tomato`/`mystery-sprout` must be
   exempted (W-FARM owns the test edit) and must never enter shop stock.
8. **`GROW_TIME_SCALE = 3`**: the 90 s target is `growSeconds: 30`. Hardcoding 90 gives
   a 270 s crop.
9. **Farm plot-cap**: 6 beds at level 1 exceeds `GARDEN_LEVELS[0] = 4`; `digBedAt`
   bypasses the cap; first garden upgrade (4→7) still works but its delta shrinks —
   accepted for D0, flagged.
10. **Flotsam gate inversion**: gate changes to `farm.exists && !opening.active` or tide
    washups fire mid-opening at 150 s.
11. **Audio gesture gate**: no sound before the first tap — wake ambience starts at
    sit-up, not fade-in. Accepted (spec's first input is ~10 s in).
12. **Slow-mo is a global dt multiplier** — day/weather timers slow too; irrelevant while
    pinned, but the multiplier must clamp to the 0.3 s window and never persist.
13. **No git repo** (F: is exFAT) — no revert safety net. Workers keep ALL new logic in
    owned files, edits to shared files strictly additive, and W-ART keeps `sand-orig.png`.
14. **HUD rebirth composition**: `isle-opening` must compose with `panel-open` and
    `cinematic` (a settings panel opened mid-opening must not resurrect unborn chrome) —
    W-UI owns the CSS interaction; the settings glyph is the only tappable chrome.
15. **Mutations could fire organically** if hour/weather pins satisfy 'dawnlit'
    conditions — opening plants use `plantScripted` (no organic rolls; farm
    `mutationsUnlocked` stays false), so mutation toasts cannot appear; keep it that way.
