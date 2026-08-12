# The Isle Opening — integration map

*How `src/main.ts` wires the opening's modules together. The binding contract is
`docs/OPENING-CONTRACT.md`; the design is `docs/ISLE-OPENING-SPEC.md`. This file
documents the integrator's side only — each module's own header docblock covers
its internals.*

## Boot decision (contract §3.2)

Decided once, immediately after `Save.load()`:

| stored record | save | result |
|---|---|---|
| none | none | fresh player → full opening from `'wake'` |
| none | exists | legacy save → `markLegacyDone()` (inside `shouldRun`), normal game, **no opening modules allocated** |
| beat ≠ done | any | resume: modules constructed, sequencer constructor replays `onBeatStart` up the chain (snap-staging for beats behind `isleBootBeat`) |
| done, firstReturnDone false | exists | normal game + return-mode construction; `beginFirstReturn(offlineSeconds)` self-gates on the 30-minute gap |
| done, firstReturnDone true | any | normal game, nothing allocated |

The `?new` wipe path calls `forgetOpening()` beside `forgetFtue()` — same
coupling, same reason. `new Ftue(false, …)` is constructed **always**: no farm
ever starts the old tutorial again, and the handover writes `sv-ftue = 'done'`
so the coach cannot wake later. The upgrade tour (its own key) still fires
post-opening, which is intended.

## Construction order (opening mode)

Everything is built **before** the sequencer, because `new OpeningSequencer`
replays `onBeatStart` synchronously in its constructor:

1. `isleGroup` (one `THREE.Group` — the modules take a Group, `engine.scene` is a Scene)
2. `OpeningUi` (+ `begin()` → `body.isle-opening`), `Tideline`, `GoatArrival` (both modes)
3. opening-only: world prep (`clearing.restoreOpened()`, `beachSeeds.restoreEmptied()`,
   day pinned to hour 7.2, `weather.set('clear')`, `postfx.setNightAmount(0)`),
   then `HoldInput` (enabled, `onTapFallthrough` → tap router), `BeachProps`,
   `ChaosPocket`, `Butterflies`, `OpeningMusic` (`start()` immediately — it
   polls for the gesture-gated AudioContext; the wake tap unlocks it),
   `createIslandBreath`
4. `OpeningSequencer` — **last**
5. `isleSyncMusicLayers()` + `isleRetargetHolds()` re-run once, because staging
   fired inside the constructor could not read `isleSeq` (binding not yet
   assigned; both are idempotent)

## Staging per beat (`isleStage`)

`replay` = beat index < `isleBootBeat` index → snap, else live:

- **wake** — live only: lie pose, camera low/close (`WAKE_YAW = -π/2`, boom on
  the sea side looking inland), fade-from-white div, 20 s wave+gull nudge loop.
  `player.object.rotation.y` is overridden per frame while lying/sitting
  (Player's `facing` is private; the override rides after `player.update`).
- **crate** — replay: `restore({crate:true})`, `isleEnsureSeeds()`, `bornSatchel`.
  Live: nothing (the pulse marker is per-frame, `isleMarkSync`).
- **shovel** — replay: `restore({shovel:true})` + `setTool('shovel')`; both: retarget.
- **clearing** — replay: `pocket.restore({cleared:true})` + `farm.openBare()`;
  live: butterflies lead (−52, 5) → (−40, 0); both: retarget.
- **plant** — both: `farm.openBare()`, `isleComputeDigSpots()` (the 7 free
  level-1 cells nearest the pocket, stable `dig-N` ids), retarget.
- **grow** — `tideline.spawnSet(1)` only when not resuming past it.
- **harvest** — retarget (the odd target is born when the gold fruit is ripe —
  the one polled retarget, guarded by `isleGoldRipeStanding`).
- **arrival** — `isleStartGoatShot(false)`: letterbox class (never `#cineTitle`),
  input frozen via `openingCinematic`, camera driven from `goat.focusPoint()`.

`onDone` → `isleHandover()`, §4.3 in order: `openingUi.end()` → gates reopen
(they all read `openingActive()`) → `syncGardenFence()` → FTUE key done →
`fadeToGameMusic()` → `HoldInput` retired.

## Per-frame (`isleFrame`, called after `worldPlots.update`)

stats (`isleBuildStats`) → `seq.update` → `holdInput.update` (skipped during
cinematics) → prompt/marker/sundial/seed-chip sync → module updates → goat
bleat-phase watch → breath → prompt-override countdown → `openingUi.update`.

Harvest counts derive from the **produce map** (`ordinariesPicked` = common
sun-tomato stacks, `oddPicked` = a gold stack exists), so a mid-beat refresh
restores them from the ordinary autosave. `tomatoesRipe` = standing-ripe +
already-picked, so picking early can never deadlock the `grow` gate.

## Input routing

- **Mouse**: `HoldInput` (window-capture) shields the legacy canvas
  `pointerdown → interactAt` while enabled; taps arrive via `onTapFallthrough`
  → `isleScreenTap` → `isleWorldTap`.
- **Touch**: `attachTouch(touchControls)` + `touchControls.onTap` routes to the
  same router *before* the `modalOpen()` gate (the wake tap happens while
  `openingCinematic` holds it true).
- **Router order** (§3.1): wake tap → crate → beds (plant / tap-pick ordinary;
  the odd fruit refuses the tap) → tide line → amphora → sand refusal
  (`crateOpened`, beats shovel/clearing/plant, `isSand`, within 2.6 u, 2.8 s
  cooldown) → tap-to-move (opening only).
- **Keyboard**: during the opening only camera/settings/mute/graphics/dev keys
  survive; every panel and tool shortcut sleeps.

## Suppression (§4.2) — all keyed on `openingActive()`

Method wrappers at the throat: `hud.toast`, `hud.eventBanner`, `popups.spawn`
(installed right after `Save.load()`, before the restore path can toast).
`grantXp` early-returns. Loop gates: wildlife, hood + arrival shots, requests,
neighbour greetings, day/weather/stock/audio-hour (day pinned at 7.2,
`nightAmount` forced 0), guide path + FTUE rings, prompts/highlights/held-tool,
FTUE/upgrade-tour/tips/store-crate, shopkeeper + farmgirl. Flotsam's gate is
`farm.exists && !openingActive()`.

## First return (§3.3, return mode)

Inert sequencer + `beginFirstReturn(offlineSeconds)` at boot. Staging: mystery
tile → `progress = 0.4` + `refreshTile` (emerged), `spawnSet(2)` + ivory pulse
on the impossible glass, goat revisit on a 60–120 s clock when any non-mystery
crop is growing (camera stolen, input free). Taps ride an `interactAt` hook
(`returnWorldTap`): washups, the mystery's one line (`notYours`), the tuft
(→ journal page again). `markFirstReturnDone()` when all three legs resolve, or
on `beforeunload`. `openPlot` and `instantGrow` both refuse the mystery sprout
so no menu or coin can spoil the reveal that never comes.

## Debug hook (`window.__isle`, DEV only)

Contract §6 exactly, plus the optional `targets()` enumerator the verify driver
probes for. The opening modules also join `window.game`
(`chaosPocket`, `beachProps`, `tidelineOpening`, `goatArrival`, `holdInput`,
`openingSequencer`, `openingUi`).

## Known couplings

- `TUFT_MARK` (−25.3, −7.7) in main.ts mirrors `TUFT_POS` in `goat.ts` for the
  session-2 pulse marker only; the collect itself goes through `tuftTargetNear`.
- The amphora tap needs no mirrored position: `tapTargetNear` gates on player
  proximity and the router accepts any tap within 2.8 u of the player.
- `createOddShimmer` is not constructed: the farm's own ripe-sparkle pipeline
  already wears the unified gold via the forced `'gold'` rarity, and doubling
  the motes read as noise. The export remains for future lotto surfaces.
- Headless note: at swiftshader frame rates the engine's 0.1 s dt clamp slows
  game time well below real time — drive tests by polling state, never by
  fixed sleeps (see `scripts/verify-opening.mjs`).
