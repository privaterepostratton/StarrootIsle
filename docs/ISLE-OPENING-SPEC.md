# Design Spec: *The Opening*

*Isle — first-session experience specification. Design-only; no implementation detail. This document is prototype-ready: an artist, a designer and an engineer should be able to build the D0 test from it.*

Scope: the first session (~8–12 minutes), from wake to the first arrival, plus the first return.
Serves: test hypotheses #1 (order-from-chaos delight) and co-primary #1 (the session promise), per the canon ledger.

---

## Governing rules (from canon — the spec inherits these)

The session promise fires from second zero: the player always has something they got and something to do. Nothing in the opening can punish, expire, or fail — impossible actions are *refused*, never penalized. The lotto is shown, never explained. Discovery replaces instruction: no modal tutorials, no arrows, no blocking popups. Input language: **tap for discrete acts, hold for shaping.** Text budget for the entire opening: **eight strings, none over six words.**

## The one-line goal

> In ten minutes, a stranger on a beach pulls a shovel out of the sand, makes a small clearing in a wild jungle, grows something, rolls their first lucky outcome, and is visited by a wild animal that wants something — and closes the app *wanting to make it stay*.

---

# PART I — THE EXPERIENCE

## 1. Art direction thesis (governs every asset below)

**Nature is Maui. Culture is Mediterranean.**

The island itself — jungle, rock, water, light — is Maui: dense volcanic green, black basalt, turquoise shallows falling to deep azure, plumeria and monstera, trade-wind palms, low golden light. Everything *human* — everything that washes up, everything the player will ever build — is Mediterranean: sun-bleached wood with flaking blue paint, terracotta, olive wood and wrought iron, rough linen, dry-stone, hand-stamped burlap. The world says *paradise*; the artifacts say *somebody's civilization, far away, sends its pieces here*.

**The bridge element is bougainvillea** — it grows wild at the jungle edge *and* will one day spill over whitewashed village walls. It appears in the opening as a splash of magenta at the treeline gap, quietly promising what the village will become.

**Palette (opening scene):**

| Role | Color | Notes |
|---|---|---|
| Sand, dry | warm ivory `#EFE3C8` | never grey |
| Sand, wet | caramel `#C9A97A` | tide band, high specular |
| Shallows | turquoise `#3EC8C0` | banded, visible from beach |
| Deep water | azure `#1B6FA8` | horizon band |
| Jungle greens | `#2E6B3A` → `#8FCF6B` | deep-to-sunlit range, never olive-drab |
| Volcanic rock | near-black `#2A2622` | white salt crust accents |
| Culture blue | faded cobalt `#4A6FA5` | crate paint, later village shutters |
| Terracotta | `#C4693B` | amphora shard, later roofs |
| Linen | `#E8DECC` | avatar clothes, seed pouch |
| Magenta accent | bougainvillea `#D14D8B` | treeline gap only |
| Lotto gold | `#F2C14E` | reserved: shimmer/odd outcomes ONLY |

**Reserved-color rule:** lotto gold appears nowhere in the environment. The first time the player sees it, it means *luck*. It means luck forever.

**Light:** the session opens at just-after-dawn — long shadows toward the sea, warm rim light on the jungle wall. Static lighting for session one (no time-of-day system needed in prototype).

**Audio thesis (mirrors the art):** island strings meet Mediterranean strings. Solo ukulele/slack-key over a wave bed at wake; a **mandolin joins at the first clear** (culture arrives as order is made); warm full theme with both families at first harvest. One composition, three vertical layers.

## 2. Camera, input, orientation (working assumptions — flagged, not canon)

- **Camera:** over-the-shoulder three-quarter, low orbit, close enough that the avatar's hands read. Camera frames *up the cross* by default (jungle above, sea behind).
- **Orientation: portrait, one-thumb.** Casual F2P reach argues portrait; OTS in portrait means avatar low in frame, world rising above — which happens to make the jungle loom, which we want. **Flag: validate in test; landscape fallback acknowledged.**
- **Input:** tap = discrete act (pick, plant, open). Hold = shaping (pull, rip, dig). Drag = walk (or tap-to-move; test both).
- **No virtual joystick in the opening if avoidable.** Movement needs are tiny; tap-to-move preferred.

## 3. Beat-by-beat script

*Format per beat: what happens · input · feedback · target time · edge handling.*

### Beat 1 — Wake (0:00–0:20)

Fade in from white-hot blur to focus: lying in dry sand, cheek down, gulls crying, waves. The avatar's hand twitches near the player's thumb.
- **Input:** tap anywhere → sit up. First input is the body, not a UI.
- **Feedback:** sand falls from clothes; a tern startles; the camera settles behind the shoulder.
- **Edge:** no input for 20s → a wave runs up near the feet (harmless), gull cries again. The world nudges, never a popup.

### Beat 2 — The crate (0:20–1:00)

Half-buried beside the wake spot: a weathered crate, faded cobalt paint, rope handles. Soft pulse on it.
- **Input:** tap → lid creaks open → **the seed pouch** lifts out (linen, hand-stamped tomato mark): *Sun Tomato ×6* and **one unmarked seed** (darker, odd-shaped, no stamp).
- **Feedback:** the satchel UI element is born at this moment — the pouch flies to a corner slot. First and only UI element on screen.
- **Note:** the unmarked seed is deliberately unexplained. It is the first mystery and the second session's payoff.

### Beat 3 — The shovel (1:00–1:30)

A rusted handle juts from the sand at an angle, ten steps away, olive-wood grip, wrought-iron blade.
- **Input:** **hold** → the avatar grips with both hands; strain; sand sluffs; it comes free with a *pop* and a stumble. Prompt string: **"Pull."**
- **Why it matters:** the first hold gesture in the game is drawing the shaping tool out of the earth. This is the input language taught in one iconic beat.
- **Feedback:** avatar holds it up a half-second; blade catches dawn light.

### Beat 4 — Refusal on the sand (1:30–2:00)

The player, holding seeds and shovel, will likely try to act here. Let them.
- **Input:** attempting to plant/dig on dry sand → the avatar tries — sand pours back into the hole.
- **String:** **"The sand won't take them."** (The game's one poetic denial. Refusal, never failure.)
- **Guidance:** two butterflies drift up-screen toward the treeline gap, where bougainvillea flares magenta against the green. Butterflies are the opening's wayfinding actors — living, ignorable, never an arrow.

### Beat 5 — The first clearing (2:00–4:00) — THE CORE BEAT

At the treeline gap: a pocket of choked ground (~6×4 units) — vine tangles, fallen fronds, a driftwood branch, two half-sunk basalt stones, a broken woven basket, a shard of terracotta amphora.
- **Input:** **hold** on each chaos object → strain → snap/crunch/pry → gone, with a material payout (wood, fibre) arcing to the satchel. Prompt string: **"Clear."**
- **Feel targets:** vine rip = elastic strain then *snap* with leaf-burst; frond = quick sweep; stones = shovel pry with grit sound; basket = crunch revealing a spiral shell (surprise inside chaos — teaches "clearing contains gifts"); amphora shard = collected whole (the player's first *keepable* — seeds the display economy silently).
- **Completion:** when the pocket is clear, the ground **exhales** — a slow drift of soft golden-green motes rises off the soil and the mandolin enters. This "island's breath" VFX is the game's permanent *blessing tell* — reused forever for "the island approves."
- **Voluntary-chaos hook:** beyond the required pocket, 3–4 *extra* chaos objects sit clearable at the pocket edges, unprompted, unneeded. **Whether players clear them anyway is the order-from-chaos metric.**
- **Edge:** all clearing is gate-free in the opening. No costs, no counters.

### Beat 6 — Dig and plant (4:00–5:00)

Open earth, dark volcanic loam.
- **Input:** **hold** to dig a bed (shovel bite ×2, soil ring forms — six beds), then **tap** a bed with pouch open → seed drops with a *plop* and a tiny soil settle. Prompts: **"Dig." "Plant."**
- **The unmarked seed:** if the player plants it (most will), it goes in like any other — and visibly does *nothing* this session. If they don't, it stays in the satchel and the moment migrates to session two.
- **Timer:** a thin **sundial ring** fades in around each planted bed — the game's timer iconography, Mediterranean sundial motif, diegetic-adjacent. Sun Tomato ring: **90 seconds.** (In-fiction: this island grows things *wrong* — fast. First hint of magic, never stated.)

### Beat 7 — The tide line (5:00–6:30)

While the ring runs, the water glints below — three washups on the wet sand band: a spiral shell, a blue sea-glass shard, a driftwood stick.
- **Input:** tap to pick. String: **"Pick."**
- **Purpose:** teaches the beach as gift surface *before the tide is ever named*, and fills the growth wait with the down-axis of the cross. No timer pressure; the tomatoes wait forever if ignored (baseline anchor).

### Beat 8 — First harvest and the first roll (6:30–8:00)

The beds are fruiting — five ordinary Sun Tomato plants and **one wrong one: oversized, gold-streaked, faintly shimmering.** (Scripted on the first harvest for every player; organic odds thereafter.)
- **Input:** tap-pick the ordinaries (satisfying pluck each); the odd one takes a **hold** — it resists slightly, then comes free with a **0.3-second slow-mo, a gold shimmer burst, and the lotto chime.**
- **THE RULE THIS ESTABLISHES:** that shimmer + chime + micro-slow-mo is the game's **lotto grammar** — identical for every roll forever: odd crops, hatching eggs, tide rarities. Specified once, reused everywhere. No text explains it. The player *felt* it.

### Beat 9 — The arrival (8:00–10:00) — THE CLIFFHANGER

Two seconds of treeline rustle (audio first, leaves shiver, camera drifts) — then **a small island goat steps out of the green.** Cream coat with one sea-foam swirl marking (the generative-texture teaser). It is wild: it ignores prompts, cannot be tapped into anything.
- **Behavior:** cautious walk to the beds → sniffs → **eats one tomato** (the player watches — this is a gift to the goat, not a loss; the plant remains) → lifts its head, looks directly at the player, ears forward, holds one full second → bleats once → bounds back into the green.
- **Journal birth:** the avatar sits, pulls a small logbook and charcoal from a pocket, and sketches the goat — the sketch appears as the journal's first page with an empty slot beside it. String: **"It wanted something."**
- **Session close state:** five tomatoes in the satchel, materials, a shell, an amphora shard, one odd golden tomato, one mystery bed, one sketch of a goat with a want. Nothing demands the player stay. Most will anyway.

## 4. The first return (session 2 open — specified thin, built into the test)

The return must deliver the session promise visibly within ten seconds of load:

1. **The mystery bed has become a sprout that doesn't match anything** — taller, wrong-colored, unopened. Tap: **"You didn't plant this."** (Its reveal is holdable — never auto-revealed, per canon 10.)
2. **The tide has turned over:** the tide line holds three new washups, one clearly unusual (sea-glass in an impossible color — lotto grammar shimmer, small).
3. **The goat comes back** if tomatoes are growing — same behavior loop, and this time it leaves something: a tuft of its coat snagged on a branch (collectable → journal, next to the sketch). The want-loop advances one step without a single word.

## 5. Text — the complete string table

| # | String | Trigger |
|---|---|---|
| 1 | "Pull." | shovel prompt |
| 2 | "The sand won't take them." | planting on beach |
| 3 | "Clear." | first chaos object |
| 4 | "Dig." | first bed |
| 5 | "Plant." | first seed |
| 6 | "Pick." | first tide-line item |
| 7 | "It wanted something." | journal after goat |
| 8 | "You didn't plant this." | mystery sprout, session 2 |

Nothing else. The odd harvest gets no text — the grammar carries it.

## 6. Tuning targets

| Milestone | Target | Kill signal |
|---|---|---|
| First input | < 10 s | > 30 s median |
| Shovel pulled | < 1:30 | < 80% by 3:00 |
| Pocket cleared | < 4:00 | clearing abandoned mid-pocket > 10% |
| **Voluntary extra clears** | **≥ 60% clear ≥ 1 unrequired object** | < 30% — order-from-chaos thesis fails |
| First harvest | < 8:00 | — |
| Goat witnessed | ≥ 95% | players wander off-screen during rustle |
| Session length | 8–12 min median | < 5 min = loop too thin |
| D1 return (diary stage) | ≥ 55% | < 35% |

---

# PART II — ASSET MANIFEST

*Design-only: intent, counts, and states. No polycounts, no tech budgets.*

## Summary

| Category | Unique assets | Notes |
|---|---|---|
| Environment set | 14 | modular jungle wall + beach |
| Clearable chaos | 7 types (~14 placed) | each: intact → straining → gone |
| Interactive props | 9 | |
| Flora (planted) | 2 species / 7 states | Sun Tomato + mystery sprout |
| Fauna | 1 hero + 5 ambient | goat is the only rigged hero |
| Avatar | 1 + 13 animations | customization deferred |
| VFX | 10 | two are permanent grammar |
| SFX | 24 | diegetic-first |
| Music | 1 theme, 3 layers | uke/slack-key + mandolin/bouzouki |
| UI | 9 elements | born contextually, none at wake |

## Environment (14)

1. Beach terrain strip — dry sand with footprint decals.
2. Wet-sand tide band — darker, specular, foam edge, washup anchor points ×8.
3. Shallows-to-deep water plane — banded turquoise→azure, gentle animated swell.
4. Horizon + **distant island silhouette** — faint, never referenced. (Mystery seed for the far future; costs nothing.)
5. Jungle wall module A — dense (impassable read).
6. Jungle wall module B — dense variant.
7. Jungle wall module C — canopy overhang with light shafts.
8. **Treeline gap** — the clearing pocket mouth; bougainvillea spill (the only magenta on screen).
9. Clearing pocket ground — choked state and cleared volcanic-loam state.
10. Basalt boulder, medium — black, white salt crust.
11. Basalt rocks, small ×2 — one prying-interactive (see chaos), one set dressing.
12. Tide pool — background prop this session; future avatar-mirror site.
13. Palm cluster ×2 — frames the beach, trade-wind sway loop.
14. Dawn skybox + static warm lighting rig.

## Clearable chaos set (7 types — the stars of the build)

Every item: **intact → straining (hold feedback) → clear**, with a material payout and a distinct destruction feel.

| # | Asset | Interaction | Drops | Feel note |
|---|---|---|---|---|
| 1 | Vine tangle A/B/C (3 meshes) | hold-rip | fibre | elastic strain, *snap*, leaf burst |
| 2 | Fallen frond litter ×2 | quick hold-sweep | fibre | dry rustle, fast |
| 3 | Driftwood branch | hold-break | wood ×2 | crack in two, pieces arc |
| 4 | Beach morning-glory mat | hold-peel | fibre | peels like turf, sandy tear |
| 5 | Broken woven basket | hold-crush | fibre + **spiral shell** | surprise inside chaos |
| 6 | Half-sunk basalt stone | shovel pry (hold) | stone | grit scrape, pop, wobble-settle |
| 7 | **Amphora shard** | tap-collect | itself (keepable) | terracotta chime; first decor item |

Plus 3–4 *extra* instances of types 1–2 placed beyond the required pocket — the voluntary-clearing measure.

## Interactive props (9)

1. **The crate** — sun-bleached wood, flaking cobalt paint, rope handles; lid-open animation; interior shadow with pouch reveal.
2. **Seed pouch** — rough linen, hand-stamped tomato mark, drawstring; satchel fly-to animation.
3. **The unmarked seed** — visibly darker, asymmetric; no stamp; reads "not from the same place."
4. **The shovel** — olive-wood handle, wrought-iron blade, active rust; buried-at-30° state and carried state. *(Head/handle upgrade ladder later; this is the base model.)*
5. Soil beds ×6 — dug rings, dark loam.
6. Tide-line washups, session 1 set — spiral shell, blue sea-glass, driftwood stick.
7. Tide-line washups, session 2 set — rope coil, odd fruit, **impossible-color sea-glass** (small lotto).
8. **The journal** — weathered logbook, charcoal; goat sketch page (illustrated asset) with one empty want-slot.
9. **Goat's coat tuft** — snag-on-branch collectable, session 2.

## Flora (2 species, 7 states)

**Sun Tomato** — 5 states: sprout · vine · flowering · fruiting (red, plump, slight sheen) · **odd-fruiting** (oversized, gold-streaked, faint shimmer — lotto gold used here for the first time).
**Mystery sprout** — 2 states this build: planted-dormant · emerged-strange (taller, wrong color, unopened bud; faint pulse at dusk). Its bloom is future content.

## Fauna (1 hero, 5 ambient)

**The goat (hero).** Small island goat, cream coat, **one sea-foam swirl marking** — the generative-texture teaser, authored for now. Rig + 8 animations: emerge-from-treeline · cautious walk · sniff · eat-crop · **look-at-player (ears forward, 1s hold)** · bleat · startled hop · bound-away. The look-at-player is the most important animation in the opening; it must feel like being *seen*.

Ambient (unrigged/simple loops): black rock crabs ×2 (scuttle) · gecko (basalt, tail flick) · white terns ×3 (flock loop + the startle at shovel pull) · **butterflies ×2 (pathable — the wayfinding actors)** · treeline rustle actor (leaves + audio, pre-goat anticipation).

## Avatar (1 + 13 animations)

Default castaway: rolled linen trousers, loose shirt, barefoot; androgynous-leaning-neutral; face simple and warm. **Customization deferred** — the tide pool becomes a diegetic mirror in a later session (flagged assumption).
Animations: wake/sit-up · stand · walk · tap-to-move jog · **hold-pull (shovel draw)** · **hold-rip (clear)** · shovel dig · kneel-plant · pick/pluck · crouch-beachcomb · sit-and-sketch · surprised (goat) · idle ×2 (gaze at sea; toes in sand).

## VFX (10)

1. Sand sluff (shovel pull).
2. Leaf burst (vine snap).
3. **The island's breath** — golden-green motes rising off cleared/blessed ground. **Permanent grammar: "the island approves."**
4. Seed plop + soil settle.
5. Growth-stage soft sparkle (subtle, non-gold).
6. **The lotto tell** — gold shimmer + 0.3s micro-slow-mo + chime. **Permanent grammar: every roll, forever.** Never used for anything else.
7. Tide foam edge + washup glint.
8. Treeline rustle (leaf shiver + drift).
9. Butterfly trail (barely-there).
10. Dusk motes at the jungle gap (session close, hints at night).

## SFX (24)

Waves (2-layer loop) · trade-wind palms · tern colony · gull cry (wake nudge) · sand footsteps · soil footsteps · shovel pull (wet shhk + pop) · vine strain-creak · vine snap · frond sweep · wood crack · basket crunch · stone pry-grit · stone pop · amphora chime · dig thunk ×3 variants · seed plop · sprout pip · tomato pluck · **lotto chime** (pairs with shimmer, nothing else may use it) · goat bleat ×2 · treeline rustle · crate lid creak · pouch paper/linen · charcoal sketching · UI soft tap.

## Music (1 theme, 3 vertical layers)

- **Layer 1 (wake):** solo ukulele/slack-key phrase over the wave bed. Sparse, unhurried.
- **Layer 2 (first clear complete):** mandolin/bouzouki enters — culture arriving as order is made. The island's breath VFX and this entrance land together.
- **Layer 3 (first harvest):** both families in the full warm theme.
- The lotto chime sits *outside* the key bed slightly — it should prick the ear.

## UI (9 — every element born contextually, screen naked at wake)

1. Satchel slot (born at pouch pickup; corner, small).
2. Contextual prompt: soft pulse circle + one-word verb. **Max one on screen, ever.**
3. **Sundial timer ring** (born at first planting) — the game's timer iconography.
4. Seed-count chip (planting only, fades after).
5. Material pickup arc + counter blip (wood/fibre).
6. Journal page — goat sketch + empty want-slot (born at Beat 9).
7. Harvest count blip.
8. Session-2 "new on the beach" soft glint marker (world-space, not HUD).
9. Settings glyph (present but 40% opacity until first menu visit).

No currency display (no currency exists yet). No XP. No level. No banner of any kind.

---

# PART III — TEST NOTES & FLAGS

## Instrumentation (design-level events)

Beat-completion timestamps (funnel) · voluntary_clear_count (the thesis metric) · attempts to interact with the goat · idle >30s with location · string #2 trigger count (how many try the sand — expect most; it's the fun kind of failure) · mystery-seed planted vs. pocketed · session length · D1 return and what they touch first (hypothesis: the mystery sprout).

## Explicit working assumptions (not canon — validate or revisit)

1. **Portrait orientation.** 2. **Tap-to-move, no joystick.** 3. **90-second first crop** (island-grows-fast as soft magic). 4. **The goat** as the arrival species. 5. **Scripted first odd-harvest**, organic odds thereafter. 6. **Deferred avatar customization** (tide-pool mirror later). 7. Clearing gate-free in the opening (the gate arrives with expansion — its design is the next open question and nothing here forecloses it).

## What this spec deliberately excludes

Monetization surfaces (none in D0) · castaway arrival (session 3+ content) · the clearing gate economy · biome depth · breeding · the pier · the Green Tide (regrowth needs a longer window than the test).

## The one sentence to protect through production

The opening is a stranger making one small pocket of order inside something vast, green, and alive — and the island *answering*: first with a breath, then with gold, then with a visitor who wants something.
