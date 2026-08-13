import * as THREE from 'three'
import type { Engine } from '../../core/engine'
import { OPENING_STRINGS, PULSE_IVORY, type OpeningStringKey } from '../../game/opening/types'
import { isHandheld } from '../fullscreen'

/**
 * Opening UI — the interface of the Isle opening, born one element at a time.
 *
 * The opening's UI rule is "screen naked at wake": `body.isle-opening` hides
 * every `.hud-chrome` cluster, and the only interface the player ever sees is
 * created *here*, at the moment its beat births it — the satchel flies in from
 * the crate, the sundial fades in around the first planted bed, the journal
 * appears when the goat leaves. Nothing exists before its moment, and the
 * whole layer retires at handover when the real HUD is staged back in.
 *
 * Everything renders in DOM, not in-world, for the same reason the popups do:
 * the browser draws text and thin rings better than a font atlas ever will,
 * and one matrix projection per element per frame is free at these counts.
 * World-anchored elements (prompt, pulse marker, sundials) are projected
 * through `engine.camera` in `update()`, exactly the popups' pipeline.
 *
 * Two disciplines this file enforces rather than trusts:
 *
 *  - **Max one prompt.** `setPrompt` owns a single element and only ever
 *    retargets it. There is no code path that can put two verbs on screen.
 *  - **No gold.** Every colour below is ivory, linen, charcoal or a muted
 *    accent. Lotto gold means luck, and the UI is never lucky.
 *
 * The stylesheet is injected as `<style id="isle-opening-css">` — zero edits
 * to styles.css. The chrome-hiding rule mirrors `body.panel-open`'s exact
 * selector shape so it wins the same specificity fights, and it composes with
 * `panel-open`/`cinematic` rather than fighting them: opening the settings
 * panel mid-opening stacks a second hide on chrome that is already hidden,
 * and closing it falls back to this rule, so unborn chrome can never
 * resurrect. The one exception is `#menuBtn` at 40% — the spec's "settings
 * glyph present" — which yields again whenever a panel or letterbox is up.
 */

/* ---------- palette (strings, because this file writes CSS) ---------- */

/** Guidance ivory — pulse rings, verbs, sundial fill. Never gold. */
const IVORY = '#' + PULSE_IVORY.toString(16).padStart(6, '0')
/** Linen — paper, pouch, chips. The Mediterranean cloth tone. */
const LINEN = '#e8decc'
/** Charcoal — the journal's sketch and caption. A warm near-black. */
const CHARCOAL = '#3f3830'

/* ---------- timings & sizes ---------- */

/** Prompt / marker fade, seconds. Gentle: these appear, never pop. */
const PROMPT_FADE = 0.45
/** The poetic line (string #2) breathes in and out over twice that. */
const POEM_FADE = 1.1
/** Seed-pouch flight from the crate to the corner slot, seconds. */
const FLY_SECONDS = 0.95
/** Staged HUD rebirth at handover: per-cluster fade time, seconds. */
const REBIRTH_FADE = 1.2
/** Extra delay stagger between chrome clusters during rebirth, seconds. */
const REBIRTH_STAGGER = 0.09

/* --- ring sizing ---------------------------------------------------------
 * Every ring in this file is a *ground* ring: it is sized from a world-space
 * radius and squashed vertically by the camera's own foreshortening, so it
 * lies in the sand instead of hovering in front of it. The pixel clamps are
 * legibility rails, not the design — they should rarely engage.
 *
 * Farm `TILE_SIZE` is 1.2 world units and the bed decal is 0.88 of that, so a
 * bed's visible half-width is ~0.53. The sundial radius sits just inside it:
 * a ring that hugs one bed's footprint and cannot reach its neighbour, which
 * is the whole difference between a sundial and a clock shop. */
const SUNDIAL_WORLD_R = 0.46
const DIAL_PX_MIN = 11
const DIAL_PX_MAX = 62
/** World radius the prompt's pulse ring hugs, in world units. */
const PULSE_WORLD_R = 0.48
const PULSE_PX_MIN = 19
const PULSE_PX_MAX = 56
/** Standalone marker clamps — smaller again; it is a glint, not a target. */
const MARK_PX_MIN = 16
const MARK_PX_MAX = 50
/** How flat a ground ring may go before it stops reading as a ring at all. */
const SQUASH_MIN = 0.34
/** Circumference of the sundial's progress circle (r=48 in a 120 viewBox). */
const DIAL_C = 2 * Math.PI * 48
/** Growth fraction past which a sundial starts retiring itself. */
const DIAL_FADE_FROM = 0.62
/** What is left of it at full growth — present, but almost gone. */
const DIAL_FADE_TO = 0.1

/* --- gesture bubble ------------------------------------------------------
 * The prompt's richer form: the same verb, plus a picture of the gesture that
 * performs it. Sized in the same currency as everything else here — the lift
 * is measured from the pulse ring's own projected radius, so the card always
 * clears the thing it points at no matter how near the camera stands. */

/** Gap in px between the top of the ground ring and the tail's tip. */
const BUBBLE_GAP = 16
/** Height of the tail triangle, px — the card floats this far above the tip. */
const BUBBLE_TAIL = 9
/** Screen margin the card is kept inside, px. */
const BUBBLE_EDGE = 12
/** Ripple radius in the 40-unit gesture viewBox. Taps only — a hold reads its
 *  progress off the bar below the verb, never off a ring around the glyph. */
const BUB_RING_R = 16.4
/** How often the card re-measures itself (font reflow, rotation), seconds. */
const BUBBLE_MEASURE_EVERY = 0.5

/* --- hold progress bar ---------------------------------------------------
 * The first build drew hold progress as a ring closing around the input glyph.
 * It was pretty and it was wrong: a ring reads as decoration until it is most
 * of the way round, and a player who has never held a button before needs to
 * see, in the first quarter second, that *something is filling and there is
 * more of it to go*. A left-to-right bar with an empty track behind it is the
 * one progress idiom every player on earth already knows, so that is what this
 * is — straight, horizontal, chunky, with the remaining distance visible.
 *
 * The yellow is chosen against a hard constraint. Lotto gold (#f2c14e) is
 * reserved for luck, and an automated scan fails any pre-beat-8 frame carrying
 * a pixel within RGB distance 40 of it — so the bar cannot simply be "yellow",
 * it has to be a yellow that survives being blended. #f8ea88 sits 71.5 away on
 * its own, and — the number that actually matters — the closest any *blend* of
 * it with the track's ink can come to gold is 51, so no antialiased edge, no
 * inner shadow and no glow along this bar can trip the check either. Which is
 * also why nothing below ever darkens the yellow: pale butter shaded down is
 * gold, and the highlight side is the only safe direction to travel.
 */
const BAR_YELLOW = '#f8ea88'
const BAR_YELLOW_HI = '#fdf7c8'
/** Rising fill tracks the press almost immediately, ms — it *is* the press. */
const BAR_FILL_MS = 80
/** A released hold drains rather than snapping, ms: progress visibly lost. */
const BAR_DRAIN_MS = 260

/** How the verb is performed. Hold = shaping, tap = a discrete act. */
export type GestureKind = 'hold' | 'tap'

/**
 * The five keys the bubble will speak. The other three strings are sentences,
 * not verbs — "The sand won't take them." in a little card with a mouse on it
 * is a tooltip, and the poem register exists precisely so it never becomes
 * one. Asking for those hides the bubble instead of boxing them.
 */
const GESTURE_KEYS = new Set<OpeningStringKey>(['pull', 'clear', 'dig', 'plant', 'pick'])

/** One live sundial ring: DOM plus the world anchor it is glued to. */
interface Dial {
  el: HTMLDivElement
  /** The inner face, whose opacity carries the grown-away fade. The wrapper's
   *  own opacity is reserved for the born/retire transitions. */
  face: SVGSVGElement
  arc: SVGCircleElement
  gnomon: SVGGElement
  pos: THREE.Vector3
  t: number
}

export class OpeningUi {
  private readonly root: HTMLDivElement

  private readonly promptEl: HTMLDivElement
  private readonly promptPulse: HTMLDivElement
  private readonly promptVerb: HTMLDivElement
  private promptKey: OpeningStringKey | null = null
  private promptPos: THREE.Vector3 | null = null
  /** Countdown to `display:none` after a fade-out begins. */
  private promptHide = 0

  private readonly bubbleEl: HTMLDivElement
  private readonly bubbleCard: HTMLDivElement
  private readonly bubbleVerb: HTMLDivElement
  private readonly bubbleGest: HTMLDivElement
  private readonly bubbleTail: HTMLDivElement
  private bubbleKey: OpeningStringKey | null = null
  private bubblePos: THREE.Vector3 | null = null
  private readonly bubbleBar: HTMLDivElement
  private readonly bubbleFill: HTMLDivElement
  private bubbleProgress = 0
  /** Last progress written, so the bar can tell filling from draining. */
  private bubbleLast = 0
  /** Whether the completion snap is currently latched. */
  private bubbleFull = false
  /** The rendered gesture cell, so an unchanged frame rebuilds nothing. */
  private bubbleGlyphKey = ''
  private bubbleHide = 0
  /** Cached card box — re-read on content change and on a slow tick, never
   *  per frame: reading a rect after writing transforms forces a layout. */
  private bubbleW = 0
  private bubbleH = 0
  private bubbleMeasure = BUBBLE_MEASURE_EVERY

  private readonly markEl: HTMLDivElement
  private markPos: THREE.Vector3 | null = null
  private markRadius = 0.6

  private readonly dials = new Map<string, Dial>()

  private readonly satchelEl: HTMLDivElement
  private satchelBorn = false

  private readonly seedChipEl: HTMLDivElement
  private readonly blipRail: HTMLDivElement

  private journalEl: HTMLDivElement | null = null
  private _journalOpen = false

  private retired = false

  /** Scratch vectors for projection — never allocated per frame. */
  private readonly proj = new THREE.Vector3()
  private readonly projEdge = new THREE.Vector3()
  private readonly camRight = new THREE.Vector3()
  private readonly camDepth = new THREE.Vector3()

  constructor(private readonly engine: Engine) {
    injectStyles()

    const ui = document.getElementById('ui') ?? document.body
    this.root = document.createElement('div')
    this.root.id = 'isleOpening'
    this.root.className = 'isle-el'
    ui.appendChild(this.root)

    // Every element exists from construction but is unborn (opacity 0, empty).
    // "Born contextually" is about what the player *sees*; pre-building the
    // nodes keeps every later call a class toggle, never a layout surprise.
    this.promptEl = document.createElement('div')
    this.promptEl.className = 'isle-el isle-prompt'
    this.promptPulse = document.createElement('div')
    this.promptPulse.className = 'isle-pulse'
    this.promptPulse.innerHTML = '<i></i><i></i>'
    this.promptVerb = document.createElement('div')
    this.promptVerb.className = 'isle-verb'
    this.promptEl.append(this.promptPulse, this.promptVerb)
    this.promptEl.style.display = 'none'
    this.root.appendChild(this.promptEl)

    this.bubbleEl = document.createElement('div')
    this.bubbleEl.className = 'isle-el isle-bubble'
    // Verb and bar share a column so the fill starts under the word's first
    // letter — the bar is the verb's read-out, not a separate widget beside it.
    this.bubbleEl.innerHTML =
      `<div class="isle-bub-card">` +
      `<div class="isle-bub-text">` +
      `<div class="isle-bub-verb"></div>` +
      `<div class="isle-bub-bar"><i class="isle-bub-fill"></i></div>` +
      `</div>` +
      `<div class="isle-bub-gest"></div>` +
      `<div class="isle-bub-tail">${tailSvg()}</div>` +
      `</div>`
    this.bubbleCard = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-card')!
    this.bubbleVerb = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-verb')!
    this.bubbleGest = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-gest')!
    this.bubbleTail = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-tail')!
    this.bubbleBar = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-bar')!
    this.bubbleFill = this.bubbleEl.querySelector<HTMLDivElement>('.isle-bub-fill')!
    this.bubbleEl.style.display = 'none'
    this.root.appendChild(this.bubbleEl)

    this.markEl = document.createElement('div')
    this.markEl.className = 'isle-el isle-mark'
    this.markEl.innerHTML = '<i></i><i></i>'
    this.markEl.style.display = 'none'
    this.root.appendChild(this.markEl)

    this.satchelEl = document.createElement('div')
    this.satchelEl.className = 'isle-el isle-satchel'
    this.satchelEl.innerHTML = pouchSvg()
    this.root.appendChild(this.satchelEl)

    this.seedChipEl = document.createElement('div')
    this.seedChipEl.className = 'isle-el isle-seedchip'
    this.root.appendChild(this.seedChipEl)

    this.blipRail = document.createElement('div')
    this.blipRail.className = 'isle-el isle-bliprail'
    this.root.appendChild(this.blipRail)
  }

  /** Whether the beat-9 journal page is currently up. */
  get journalOpen(): boolean {
    return this._journalOpen
  }

  /* ---------- lifecycle ---------- */

  /** Hide all HUD chrome. Called once, before the first frame of the wake. */
  begin(): void {
    document.body.classList.add('isle-opening')
    document.body.classList.remove('isle-settings')
  }

  /**
   * Let the settings glyph exist.
   *
   * The spec's UI element 9 is "settings glyph (present but 40% opacity)", and
   * the first build read that as *from frame one* — so the very first image of
   * the game, a stranger face-down in the sand before they have touched
   * anything, carried a blue gear in the corner. "Screen naked at wake" is not
   * a rule about how many pixels of chrome there are; it is about the player's
   * first second belonging to the body, not to the interface. So the glyph is
   * withheld and then fades in over a second and a half, and it is `setPrompt`
   * that calls this: the opening's first verb is *Pull* at beat 3, which is
   * both the moment the player has demonstrably taken control and the earliest
   * point the spec's own review would allow. Idempotent; safe every frame.
   */
  revealSettings(): void {
    if (this.retired) return
    document.body.classList.add('isle-settings')
  }

  /**
   * Staged HUD rebirth at handover.
   *
   * The chrome elements get a temporary *inline* transition — 1.2s, staggered
   * per cluster — before the body class is removed, so the stylesheet's snappy
   * 0.16s hide/show transition is overridden for exactly this one reveal and
   * then handed back. Inline rather than a rebirth class because the layout
   * editor treats unknown classes as identity (`keys.ts` VOLATILE is a closed
   * list) and a third state class would have to join it; two style properties
   * that erase themselves 2.6s later leave no trace anywhere.
   */
  end(): void {
    if (this.retired) return
    this.retired = true

    const chrome = Array.from(document.querySelectorAll<HTMLElement>('#ui .hud-chrome'))
    chrome.forEach((el, i) => {
      el.style.transition = `opacity ${REBIRTH_FADE}s ease, transform ${REBIRTH_FADE}s var(--spring)`
      el.style.transitionDelay = `${Math.min(i * REBIRTH_STAGGER, 0.7)}s`
    })
    document.body.classList.remove('isle-opening')
    document.body.classList.remove('isle-settings')
    window.setTimeout(() => {
      for (const el of chrome) {
        el.style.transition = ''
        el.style.transitionDelay = ''
      }
    }, (REBIRTH_FADE + 0.8) * 1000 + 600)

    // The opening layer itself fades and leaves — the real hotbar replaces
    // the satchel, so nothing here survives into the normal game.
    this.root.classList.add('isle-retire')
    window.setTimeout(() => this.root.remove(), 900)
  }

  /* ---------- satchel ---------- */

  /**
   * The first UI element on screen: the seed pouch flies from the opened
   * crate to a corner slot, and the slot pops in as it lands. Idempotent —
   * a resumed session that replays the crate beat just keeps its satchel.
   */
  bornSatchel(fromWorld: THREE.Vector3): void {
    if (this.satchelBorn || this.retired) return
    this.satchelBorn = true

    const start = this.project(fromWorld, 0.6)
    if (!start) {
      // Crate behind the camera (jumpTo staging): skip the flight, just land.
      this.satchelEl.classList.add('born')
      return
    }

    const slot = this.satchelEl.getBoundingClientRect()
    const tx = slot.left + slot.width / 2
    const ty = slot.top + slot.height / 2

    const ghost = document.createElement('div')
    ghost.className = 'isle-el isle-fly'
    ghost.innerHTML = pouchSvg(44)
    ghost.style.transform = `translate(${start.x}px, ${start.y}px) translate(-50%, -50%)`
    this.root.appendChild(ghost)
    void ghost.offsetWidth // commit the start frame before the transition
    // Lands at exactly the slot glyph's size, so the ghost *becomes* the icon.
    ghost.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(0.77)`

    window.setTimeout(() => {
      ghost.remove()
      this.satchelEl.classList.add('born')
    }, FLY_SECONDS * 1000)
  }

  /* ---------- prompt & marker ---------- */

  /**
   * THE one contextual prompt: a soft ivory pulse circle at a world point
   * with a one-word verb above it. A single owned element makes "max one on
   * screen" structural rather than policed. Passing `null` fades it out;
   * calling every frame with the same key is a no-op. Without a `worldPos`
   * (the sand refusal, mid-air moments) the text floats low and centred and
   * the circle stays hidden.
   *
   * Two typographic registers share the element, because the opening speaks
   * in two voices. The **verbs** — Pull, Clear, Dig, Plant, Pick — are small,
   * widely letter-spaced and almost hushed: an instruction the island barely
   * bothers to give. String #2, *"The sand won't take them."*, is the only
   * sentence the game says all session, so it gets the `poem` register: the
   * journal's italic hand, larger, slower, with a fade twice as long at both
   * ends. Same colour, same restraint — a different breath.
   */
  setPrompt(key: OpeningStringKey | null, worldPos?: THREE.Vector3): void {
    if (this.retired) return
    if (key === null) {
      if (this.promptKey !== null) {
        this.promptHide = this.promptKey === 'sand' ? POEM_FADE : PROMPT_FADE
        this.promptKey = null
        this.promptEl.classList.remove('born')
      }
      return
    }

    // The first verb the island gives is also when the settings glyph is
    // allowed to exist — see `revealSettings`.
    this.revealSettings()

    // Retarget: keep the anchor fresh even when the key is unchanged.
    this.promptPos = worldPos ? (this.promptPos ?? new THREE.Vector3()).copy(worldPos) : null
    this.promptEl.classList.toggle('nopos', !worldPos)
    if (key === this.promptKey) return

    this.promptKey = key
    this.promptHide = 0
    this.promptEl.classList.toggle('poem', key === 'sand')
    this.promptVerb.textContent = OPENING_STRINGS[key]
    this.promptEl.style.display = ''
    void this.promptEl.offsetWidth // restart the fade if it was mid-out
    this.promptEl.classList.add('born')
  }

  /**
   * The gesture bubble — the prompt's richer form, and the only place the
   * opening ever explains *how*.
   *
   * The spec forbade instructional popups on the theory that discovery beats
   * instruction; the owner played it and could not tell whether to tap or to
   * hold, which is the one thing this island genuinely cannot teach by being
   * beautiful at you. So: a small linen card above the object, carrying the
   * verb it already had, plus a picture of the gesture. No new words — the
   * text budget is eight strings and this adds none. Everything the card says
   * beyond the verb it says in ink:
   *
   *  - **hold** → a bar under the verb that fills left to right in pale
   *    butter yellow, with its empty track showing how much is left to go.
   *    `progress` is the live 0..1 from `HoldInput`, so the bar is not a hint
   *    about the gesture, it *is* the gesture's read-out: it rises with the
   *    press in 80ms, drains over 260ms when the press is abandoned so lost
   *    progress is visibly lost, and snaps once at full.
   *  - **tap** → no bar at all; concentric ripples leave the glyph on the beat
   *    of a tap, because a discrete act has no duration to draw.
   *  - and inside both, the device's own input: a mouse with its left button
   *    inked on desktop, a fingertip on a handheld. No key cap, because
   *    `core/input.ts` binds no key to interaction at all — WASD/arrows move
   *    and nothing else is bound. A `Space` cap would be a lie in a picture.
   *
   * "Max one prompt" survives because the card *is* the prompt when it is up:
   * `update()` hushes `.isle-verb` while the bubble is visible, so the word
   * exists once on screen, in the card, over the ring that marks the spot.
   *
   * Cheap to call every frame — only a changed key/gesture rebuilds any DOM,
   * and an unchanged progress writes nothing at all. Non-verb keys (the poem,
   * the journal lines) hide the bubble rather than boxing a sentence.
   *
   * @param key      verb to show, or `null` to fade the card out.
   * @param worldPos object the card points at; omitted, it floats screen-low
   *                 and tailless, matching the prompt's own `nopos` register.
   * @param gesture  `'hold'` (pull/clear/dig/odd fruit) or `'tap'`.
   * @param progress 0..1 hold progress; ignored for taps.
   */
  setGestureBubble(
    key: OpeningStringKey | null,
    worldPos?: THREE.Vector3 | null,
    gesture: GestureKind = 'tap',
    progress = 0,
  ): void {
    if (this.retired) return
    if (key !== null && !GESTURE_KEYS.has(key)) key = null

    if (key === null) {
      if (this.bubbleKey !== null) {
        this.bubbleKey = null
        this.bubbleHide = PROMPT_FADE
        this.bubbleEl.classList.remove('born')
        this.promptEl.classList.remove('hushed')
        // Hidden part-way up, the bar drains as the card leaves, so an
        // abandoned hold is still seen to be lost. Hidden *full* it is left
        // full: the last frame of a completed hold should read completed.
        if (!this.bubbleFull) this.writeBar(0)
      }
      return
    }

    this.bubblePos = worldPos ? (this.bubblePos ?? new THREE.Vector3()).copy(worldPos) : null
    this.bubbleEl.classList.toggle('nopos', !worldPos)
    // The bar exists only for holds — `.hold` on the wrapper is what reveals it.
    this.bubbleEl.classList.toggle('hold', gesture === 'hold')

    // The glyph cell is rebuilt only when what it depicts actually changes.
    const glyphKey = `${gesture}|${isHandheld() ? 'finger' : 'mouse'}`
    if (glyphKey !== this.bubbleGlyphKey) {
      this.bubbleGlyphKey = glyphKey
      this.bubbleGest.innerHTML = gestureSvg(gesture, isHandheld())
      this.bubbleGest.className = `isle-bub-gest ${gesture}`
      this.bubbleMeasure = 0
    }

    // A new verb is a new target: the bar starts empty, and it *cuts* to empty
    // rather than draining, because draining a bar the player never filled is
    // a read-out of the previous object's abandoned hold.
    if (key !== this.bubbleKey) {
      this.bubbleKey = key
      this.bubbleHide = 0
      this.bubbleVerb.textContent = OPENING_STRINGS[key]
      this.resetBar()
      this.bubbleEl.style.display = ''
      this.bubbleMeasure = 0
      void this.bubbleEl.offsetWidth // restart the fade if it was mid-out
      this.bubbleEl.classList.add('born')
    }

    this.bubbleProgress = gesture === 'hold' ? THREE.MathUtils.clamp(progress, 0, 1) : 0
    // Pressed state kills the idle breath so the bar is the only motion.
    this.bubbleGest.classList.toggle('pressing', this.bubbleProgress > 0.001)
    this.writeBar(this.bubbleProgress)
  }

  /**
   * Drive the fill.
   *
   * Two durations, picked per call by direction, are the whole trick: filling
   * is 80ms so the bar sits under the player's thumb rather than lagging it,
   * and *un*filling is 260ms so a released hold is seen to lose its ground
   * instead of blinking back to zero — a cancel the player does not see is a
   * cancel they will make again. The width is a percentage, never a scaleX,
   * so the fill keeps its round cap at every length instead of squashing it.
   */
  private writeBar(p: number): void {
    if (Math.abs(p - this.bubbleLast) > 0.0005) {
      this.bubbleFill.style.transitionDuration = `${p >= this.bubbleLast ? BAR_FILL_MS : BAR_DRAIN_MS}ms`
      this.bubbleFill.style.width = `${(p * 100).toFixed(2)}%`
      this.bubbleLast = p
    }
    // Latched, so the snap fires once at the top and re-arms on the way down.
    const full = p >= 0.999
    if (full !== this.bubbleFull) {
      this.bubbleFull = full
      this.bubbleBar.classList.toggle('full', full)
    }
  }

  /** Cut the bar back to empty with no transition and no completion latch. */
  private resetBar(): void {
    this.bubbleFull = false
    this.bubbleLast = 0
    this.bubbleBar.classList.remove('full')
    this.bubbleFill.style.transitionDuration = '0ms'
    this.bubbleFill.style.width = '0%'
  }

  /**
   * Standalone soft-pulse marker — the crate, the shovel, a washup glint.
   * Same ivory language as the prompt, no words. `null` hides it.
   */
  pulseAt(worldPos: THREE.Vector3 | null, radius = 0.6): void {
    if (this.retired) return
    if (!worldPos) {
      this.markPos = null
      this.markEl.classList.remove('born')
      return
    }
    this.markPos = (this.markPos ?? new THREE.Vector3()).copy(worldPos)
    this.markRadius = radius
    this.markEl.style.display = ''
    this.markEl.classList.add('born')
  }

  /* ---------- sundials ---------- */

  /**
   * A thin sundial ring lying *in* a planted bed.
   *
   * It is one hairline ring at the bed's own footprint, one slim gnomon
   * sweeping from the centre, and the ivory trail that gnomon leaves behind
   * it as the crop fills. One notch at noon is the only mark on the plate —
   * a clock face has twelve, and six clock faces on a beach is a shop.
   * The ring is squashed to the ground plane in `update()`, which is what
   * makes it read as scratched into the loam rather than pinned to the glass.
   *
   * It also retires itself: past `DIAL_FADE_FROM` the whole face dims toward
   * near-nothing, so the beds you are *waiting* on are the ones you see and a
   * ripe bed is left to the fruit.
   *
   * Called every frame per bed — creation on the first call, attribute writes
   * for every one after.
   */
  sundial(bedKey: string, worldPos: THREE.Vector3, t: number): void {
    if (this.retired) return
    let dial = this.dials.get(bedKey)
    if (!dial) {
      const el = document.createElement('div')
      el.className = 'isle-el isle-sundial'
      el.innerHTML = sundialSvg()
      this.root.appendChild(el)
      dial = {
        el,
        face: el.querySelector<SVGSVGElement>('svg')!,
        arc: el.querySelector<SVGCircleElement>('.isle-dial-arc')!,
        gnomon: el.querySelector<SVGGElement>('.isle-dial-gnomon')!,
        pos: worldPos.clone(),
        t: 0,
      }
      this.dials.set(bedKey, dial)
      void el.offsetWidth
      el.classList.add('born')
    }
    dial.pos.copy(worldPos)
    dial.t = THREE.MathUtils.clamp(t, 0, 1)
  }

  /** Fade a bed's sundial out and forget it (harvested, or bed cleared). */
  clearSundial(bedKey: string): void {
    const dial = this.dials.get(bedKey)
    if (!dial) return
    this.dials.delete(bedKey)
    dial.el.classList.remove('born')
    window.setTimeout(() => dial.el.remove(), 700)
  }

  /* ---------- chips & blips ---------- */

  /**
   * Seed-count chip beside the satchel, visible during planting only.
   * Digits and a seed glyph — the text budget stays untouched.
   */
  seedChip(count: number | null): void {
    if (this.retired) return
    if (count === null) {
      this.seedChipEl.classList.remove('born')
      return
    }
    this.seedChipEl.innerHTML = `${seedSvg()}<b>${Math.max(0, Math.floor(count))}</b>`
    this.seedChipEl.classList.add('born')
  }

  /** Tiny material-payout blip above the satchel: a kind-coloured dot and +n. */
  blipMaterial(kind: 'wood' | 'fiber' | 'stone' | 'keepable', n: number): void {
    this.blip(BLIP_TINT[kind], n)
  }

  /** Harvest-count blip — same grammar, tomato-red dot. */
  blipHarvest(n: number): void {
    this.blip('#d95f45', n)
  }

  /**
   * Blips ride a rail above the satchel and stack upward like miniature
   * toasts, so a clearing spree reads as a column rather than a smear.
   * CSS animates and `animationend` reaps — no per-frame bookkeeping.
   */
  private blip(tint: string, n: number): void {
    if (this.retired) return
    const el = document.createElement('div')
    el.className = 'isle-el isle-blip'
    el.innerHTML = `<i style="background:${tint}"></i>+${Math.max(1, Math.floor(n))}`
    el.style.bottom = `${this.blipRail.children.length * 21}px`
    this.blipRail.appendChild(el)
    el.addEventListener('animationend', () => el.remove())
  }

  /* ---------- journal ---------- */

  /**
   * Beat-9 journal page: a weathered paper sheet with the charcoal goat
   * sketch, an empty want-slot beside it, and the opening's seventh string.
   * Tap anywhere dismisses. The sketch is authored inline SVG — wobbled by
   * a turbulence filter so the line reads as hand-drawn charcoal, with a
   * faint second pass like a sketcher finding the line.
   *
   * The page itself is four things a rounded rectangle is not, and it needs
   * all four or it reads as a toast with a drawing in it: a **fibre weave**
   * (linen is woven, and a flat fill is the single loudest tell that a surface
   * is a div); a **stitched binding** down one side with the thread showing,
   * because a logbook is bound and a card is not; a **warp** — the sheet is
   * held at an angle in someone's hands, so it takes perspective rather than
   * sitting parallel to the glass; and a **charcoal smudge**, the heel of the
   * hand dragged across the drawing while it was being made. The last one is
   * the cheapest and does the most work: nothing says *this was drawn by a
   * person a moment ago* like the mess they left doing it.
   */
  showJournal(onDismiss: () => void): void {
    if (this.retired || this._journalOpen) return
    this._journalOpen = true

    const el = document.createElement('div')
    el.className = 'isle-el isle-journal'
    el.innerHTML =
      `<div class="isle-page">` +
      `<div class="isle-bind"></div>` +
      `<div class="isle-sketch">${goatSketchSvg()}<i class="isle-smudge"></i>` +
      `<i class="isle-smear"></i></div>` +
      `<div class="isle-want"></div>` +
      `<div class="isle-caption"></div>` +
      `</div>`
    el.querySelector<HTMLDivElement>('.isle-caption')!.textContent = OPENING_STRINGS.wanted
    this.journalEl = el
    this.root.appendChild(el)
    void el.offsetWidth
    el.classList.add('born')

    el.addEventListener(
      'pointerdown',
      () => {
        this._journalOpen = false
        el.classList.remove('born')
        window.setTimeout(() => {
          el.remove()
          if (this.journalEl === el) this.journalEl = null
        }, 500)
        onDismiss()
      },
      { once: true },
    )
  }

  /* ---------- frame ---------- */

  /** Project every world-anchored element through the camera. */
  update(dt: number): void {
    if (this.retired) return

    // Prompt: finish a fade-out, then place.
    if (this.promptHide > 0) {
      this.promptHide -= dt
      if (this.promptHide <= 0 && this.promptKey === null) {
        this.promptEl.style.display = 'none'
      }
    }
    if (this.promptEl.style.display !== 'none') {
      if (this.promptPos) {
        const p = this.project(this.promptPos, 0.12)
        if (p) {
          this.promptEl.style.visibility = ''
          this.promptEl.style.transform = `translate(${p.x}px, ${p.y}px)`
          const r = THREE.MathUtils.clamp(
            this.pxRadius(this.promptPos, PULSE_WORLD_R),
            PULSE_PX_MIN,
            PULSE_PX_MAX,
          )
          const k = this.squash(this.promptPos, PULSE_WORLD_R)
          this.promptPulse.style.width = this.promptPulse.style.height = `${r * 2}px`
          this.promptPulse.style.transform = `translate(-50%, -50%) scaleY(${k.toFixed(3)})`
          // Clear the flattened ring, not the round one it would have been.
          const lift = r * k + 14
          this.promptVerb.style.transform = `translate(-50%, -100%) translateY(${-lift}px)`
        } else {
          this.promptEl.style.visibility = 'hidden'
        }
      } else {
        // Screen-anchored: low and centred, under the avatar, out of the sea.
        this.promptEl.style.visibility = ''
        this.promptEl.style.transform = `translate(${innerWidth / 2}px, ${innerHeight * 0.72}px)`
        this.promptVerb.style.transform = 'translate(-50%, -50%)'
      }
    }

    // Gesture bubble: finish a fade-out, measure, place, and hush the verb
    // underneath it so the word is never on screen twice.
    if (this.bubbleHide > 0) {
      this.bubbleHide -= dt
      if (this.bubbleHide <= 0 && this.bubbleKey === null) {
        this.bubbleEl.style.display = 'none'
      }
    }
    let bubbleUp = false
    if (this.bubbleEl.style.display !== 'none') {
      this.bubbleMeasure -= dt
      if (this.bubbleMeasure <= 0) {
        this.bubbleMeasure = BUBBLE_MEASURE_EVERY
        const box = this.bubbleCard.getBoundingClientRect()
        if (box.width > 0) {
          this.bubbleW = box.width
          this.bubbleH = box.height
        }
      }
      const half = this.bubbleW / 2
      if (this.bubblePos) {
        const p = this.project(this.bubblePos, 0.12)
        if (p) {
          bubbleUp = this.bubbleKey !== null
          this.bubbleEl.style.visibility = ''
          // Lift is the ground ring's own projected top plus a gap: the card
          // rides higher when you stand close and the ring is big, so it can
          // never sit on the thing it is pointing at.
          const r = THREE.MathUtils.clamp(
            this.pxRadius(this.bubblePos, PULSE_WORLD_R),
            PULSE_PX_MIN,
            PULSE_PX_MAX,
          )
          const k = this.squash(this.bubblePos, PULSE_WORLD_R)
          const tipY = Math.max(
            this.bubbleH + BUBBLE_TAIL + BUBBLE_EDGE,
            p.y - (r * k + BUBBLE_GAP),
          )
          const x = THREE.MathUtils.clamp(
            p.x,
            half + BUBBLE_EDGE,
            Math.max(half + BUBBLE_EDGE, innerWidth - half - BUBBLE_EDGE),
          )
          this.bubbleEl.style.transform = `translate(${x}px, ${tipY}px)`
          // Pushed off a screen edge, the card stays put and the tail slides
          // along its underside — it points at the object, not at itself.
          const dx = THREE.MathUtils.clamp(p.x - x, -(half - 18), half - 18)
          this.bubbleTail.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), 0)`
        } else {
          this.bubbleEl.style.visibility = 'hidden'
        }
      } else {
        // Tailless, screen-anchored: just above where the prompt would sit.
        bubbleUp = this.bubbleKey !== null
        this.bubbleEl.style.visibility = ''
        this.bubbleEl.style.transform = `translate(${innerWidth / 2}px, ${innerHeight * 0.72}px)`
      }
    }
    this.promptEl.classList.toggle('hushed', bubbleUp)

    /*
     * Standalone marker — suppressed while the prompt is ringing the same
     * thing.
     *
     * "Max one on screen, ever" is the spec's rule for the contextual prompt,
     * and the letter of it is kept by `setPrompt` owning a single element. The
     * *spirit* of it is about rings: the marker and the prompt speak the same
     * ivory language, and the staging quite reasonably points both at whatever
     * the player should touch next — so the dig beat was drawing two
     * concentric ivory circles around one patch of loam, which reads as a
     * targeting reticle rather than as the island quietly indicating. Whenever
     * the two anchors are close enough to overlap, the prompt wins: it carries
     * the verb, and the marker is only ever the wordless version of it.
     */
    const markMerged =
      !!this.markPos &&
      !!this.promptPos &&
      this.promptEl.style.display !== 'none' &&
      this.markPos.distanceTo(this.promptPos) < PULSE_WORLD_R + this.markRadius
    if (this.markPos && !markMerged) {
      const p = this.project(this.markPos, 0.12)
      if (p) {
        this.markEl.style.visibility = ''
        const r = THREE.MathUtils.clamp(
          this.pxRadius(this.markPos, this.markRadius),
          MARK_PX_MIN,
          MARK_PX_MAX,
        )
        const k = this.squash(this.markPos, this.markRadius)
        this.markEl.style.transform =
          `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scaleY(${k.toFixed(3)})`
        this.markEl.style.width = this.markEl.style.height = `${r * 2}px`
      } else {
        this.markEl.style.visibility = 'hidden'
      }
    } else if (markMerged) {
      this.markEl.style.visibility = 'hidden'
    }

    // Sundials.
    for (const dial of this.dials.values()) {
      const p = this.project(dial.pos, 0.04)
      if (!p) {
        dial.el.style.visibility = 'hidden'
        continue
      }
      dial.el.style.visibility = ''
      const r = THREE.MathUtils.clamp(
        this.pxRadius(dial.pos, SUNDIAL_WORLD_R),
        DIAL_PX_MIN,
        DIAL_PX_MAX,
      )
      const k = this.squash(dial.pos, SUNDIAL_WORLD_R)
      dial.el.style.transform =
        `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scaleY(${k.toFixed(3)})`
      dial.el.style.width = dial.el.style.height = `${r * 2}px`

      const t = dial.t
      dial.arc.setAttribute('stroke-dashoffset', String(DIAL_C * (1 - t)))
      dial.gnomon.setAttribute('transform', `rotate(${(t * 360).toFixed(2)} 60 60)`)
      // Nearly grown → nearly gone. The fruit takes over the telling.
      const grown = t <= DIAL_FADE_FROM ? 0 : (t - DIAL_FADE_FROM) / (1 - DIAL_FADE_FROM)
      dial.face.style.opacity = (1 - grown * (1 - DIAL_FADE_TO)).toFixed(3)
    }
  }

  /* ---------- projection helpers (the popups' pipeline) ---------- */

  private project(world: THREE.Vector3, lift: number): { x: number; y: number } | null {
    this.proj.set(world.x, world.y + lift, world.z).project(this.engine.camera)
    if (this.proj.z > 1) return null
    return {
      x: (this.proj.x * 0.5 + 0.5) * innerWidth,
      y: (-this.proj.y * 0.5 + 0.5) * innerHeight,
    }
  }

  /**
   * Pixel radius of a world-space radius at a point: project the point and a
   * second point one radius away along `axis`, measure the screen gap. Exact
   * under perspective, so near beds get big rings and far ones small — which
   * is what glues a DOM ring to the ground visually.
   */
  private pxRadius(world: THREE.Vector3, r: number, axis?: THREE.Vector3): number {
    const cam = this.engine.camera
    const dir = axis ?? this.camRight.setFromMatrixColumn(cam.matrixWorld, 0)
    this.proj.copy(world).project(cam)
    this.projEdge.copy(world).addScaledVector(dir, r).project(cam)
    const dx = (this.projEdge.x - this.proj.x) * 0.5 * innerWidth
    const dy = (this.projEdge.y - this.proj.y) * 0.5 * innerHeight
    return Math.hypot(dx, dy)
  }

  /**
   * Vertical squash that turns a circle into the ellipse a ground ring
   * actually makes on screen.
   *
   * Measure the ring's radius twice — once across the screen (camera-right)
   * and once *into* it (camera-forward flattened onto the ground) — and the
   * ratio is the camera's own foreshortening at that point. Feed it to
   * `scaleY` and a DOM circle lies down in the sand. This is the single
   * cheapest thing that stops a projected ring reading as a HUD dial, and it
   * costs one extra projection per element per frame.
   */
  private squash(world: THREE.Vector3, r: number): number {
    const cam = this.engine.camera
    this.camDepth.setFromMatrixColumn(cam.matrixWorld, 2) // +Z is camera-backward
    this.camDepth.y = 0
    if (this.camDepth.lengthSq() < 1e-6) return 1
    this.camDepth.normalize()
    const across = this.pxRadius(world, r, this.camRight.setFromMatrixColumn(cam.matrixWorld, 0))
    if (across < 0.01) return 1
    const into = this.pxRadius(world, r, this.camDepth)
    return THREE.MathUtils.clamp(into / across, SQUASH_MIN, 1)
  }
}

/** Blip dot tints — muted, paper-adjacent, and pointedly not gold. */
const BLIP_TINT: Record<'wood' | 'fiber' | 'stone' | 'keepable', string> = {
  wood: '#a97a4e',
  fiber: '#a8c187',
  stone: '#9a938a',
  keepable: '#c4693b',
}

/* ======================================================================
 * Inline art. Authored here, not fetched: the opening must not add a
 * single network request, and these are a few hundred bytes of path data.
 * ==================================================================== */

/** The linen seed pouch — satchel slot icon and the fly-to ghost. */
function pouchSvg(size = 34): string {
  return (
    `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="M13 17 C 8 33, 14 42, 24 42 C 34 42, 40 33, 35 17 C 31 13, 17 13, 13 17 Z"` +
    ` fill="${LINEN}" stroke="#a8906c" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M13 17 C 18 21, 30 21, 35 17" fill="none" stroke="#a8906c" stroke-width="1.6"/>` +
    `<path d="M18 14 C 18 8, 30 8, 30 14" fill="none" stroke="#a8906c" stroke-width="2" stroke-linecap="round"/>` +
    // The hand-stamped tomato mark — desaturated terracotta, a stamp not a fruit.
    `<circle cx="24" cy="30" r="6.5" fill="none" stroke="#c96a4f" stroke-width="2"/>` +
    `<path d="M22 25 q 2 -3 5 -3" fill="none" stroke="#7f9c6b" stroke-width="1.8" stroke-linecap="round"/>` +
    `</svg>`
  )
}

/** A single seed glyph for the count chip. */
function seedSvg(): string {
  return (
    `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">` +
    `<ellipse cx="10" cy="11" rx="5.5" ry="7" transform="rotate(24 10 11)"` +
    ` fill="#8a6b46" stroke="#6d5233" stroke-width="1.4"/>` +
    `</svg>`
  )
}

/* ---------- gesture bubble art ---------- */

/** The bubble's tail. Drawn from above the top edge so the stroke's cut ends
 *  are clipped by the viewBox and the triangle grows out of the card. */
function tailSvg(): string {
  return (
    `<svg viewBox="0 0 18 11" width="18" height="11" aria-hidden="true">` +
    `<path d="M0.9 -3 L9 9.7 L17.1 -3" fill="#d8caa9"` +
    ` stroke="rgba(184, 160, 118, 0.85)" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg>`
  )
}

/**
 * The gesture cell: the device's own input glyph, and — for taps only — the
 * ripples that leave it.
 *
 * 40-unit viewBox, drawn in charcoal because it lives on linen — the same ink
 * as the journal sketch, which is the only other place this game draws rather
 * than writes. A hold gets *no* decoration here on purpose: its read-out is the
 * bar below the verb, and a ring around the glyph as well would be the same
 * number said twice in two idioms, one of which the owner could not read.
 * Holding, the glyph just squeezes, which is what a held button looks like.
 */
function gestureSvg(gesture: GestureKind, handheld: boolean): string {
  const glyph = handheld ? fingerGlyph() : mouseGlyph()
  const decor =
    gesture === 'hold'
      ? ''
      : `<circle class="isle-bub-rip" cx="20" cy="20" r="${BUB_RING_R}" fill="none"` +
        ` stroke="${CHARCOAL}" stroke-width="1.9" opacity="0"/>` +
        `<circle class="isle-bub-rip r2" cx="20" cy="20" r="${BUB_RING_R}" fill="none"` +
        ` stroke="${CHARCOAL}" stroke-width="1.9" opacity="0"/>`
  return (
    `<svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">` +
    decor +
    `<g class="isle-bub-glyph">${glyph}</g>` +
    `</svg>`
  )
}

/**
 * A mouse, left button inked.
 *
 * Desktop gets a mouse and never a key cap: `core/input.ts` binds WASD and the
 * arrows for movement and nothing at all for interaction — every press in the
 * opening arrives through `HoldInput`'s pointer path. A `Space` cap would be a
 * picture of a control that does not exist.
 */
function mouseGlyph(): string {
  return (
    `<rect x="13.2" y="10.8" width="13.6" height="18.4" rx="6.8"` +
    ` fill="rgba(63, 56, 48, 0.06)" stroke="${CHARCOAL}" stroke-width="1.6" opacity="0.86"/>` +
    // The left button, filled: which button, said without saying it.
    `<path d="M20 10.8 A6.8 6.8 0 0 0 13.2 17.6 L13.2 19.1 L20 19.1 Z"` +
    ` fill="${CHARCOAL}" opacity="0.7"/>` +
    `<path d="M13.2 19.1 H26.8 M20 10.9 V19.1" fill="none" stroke="${CHARCOAL}"` +
    ` stroke-width="1.3" opacity="0.5"/>`
  )
}

/** A fingertip, for coarse pointers: index finger over a closed hand. */
function fingerGlyph(): string {
  return (
    `<g transform="translate(-0.6 0)" fill="rgba(63, 56, 48, 0.13)" stroke="${CHARCOAL}"` +
    ` stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.88">` +
    `<path d="M20.4 10.4 a2.35 2.35 0 0 1 2.35 2.35 V20.6 h-4.7 v-7.85 a2.35 2.35 0 0 1 2.35 -2.35 Z"/>` +
    `<path d="M15.4 19.7 h9.4 a3.5 3.5 0 0 1 3.5 3.5 v1.5 a5.3 5.3 0 0 1 -5.3 5.3` +
    ` h-4.6 a5 5 0 0 1 -5 -5 v-2.8 a2.5 2.5 0 0 1 2 -2.5 Z"/>` +
    `</g>` +
    // One crease across the knuckles — the difference between a hand and a bag.
    `<path d="M17.4 23.6 h5.2" fill="none" stroke="${CHARCOAL}" stroke-width="1.2"` +
    ` stroke-linecap="round" opacity="0.34"/>`
  )
}

/**
 * The sundial face — four marks in total, and that is the whole design.
 *
 * Radius 48 in a 120 viewBox. A hairline plate ring; one notch sitting just
 * outside it at noon (a dial needs somewhere its day begins, and one notch
 * says so where twelve would say *clock*); the gnomon, a slim tapered line
 * from the centre pin; and the ivory trail the gnomon has already swept,
 * drawn as a dashed-offset arc rotated -90 so growth starts at that notch.
 *
 * Weights are deliberately under the eye's threshold at rest — 1.0–1.9 px in
 * a 96 px face, none of them opaque. Six of these lying in the loam should
 * register as *the beds are busy*, not as six instruments.
 */
function sundialSvg(): string {
  return (
    `<svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true">` +
    // The plate: one hairline ring at the bed's own edge.
    `<circle cx="60" cy="60" r="48" fill="none" stroke="${LINEN}"` +
    ` stroke-width="1" opacity="0.3"/>` +
    // Noon. The only mark on the plate.
    `<line x1="60" y1="5.5" x2="60" y2="11" stroke="${LINEN}"` +
    ` stroke-width="1.4" stroke-linecap="round" opacity="0.36"/>` +
    // The swept trail, laid down before the gnomon so the line reads on top.
    `<circle class="isle-dial-arc" cx="60" cy="60" r="48" fill="none" stroke="${IVORY}"` +
    ` stroke-width="1.9" stroke-linecap="round" opacity="0.55"` +
    ` stroke-dasharray="${DIAL_C.toFixed(1)}"` +
    ` stroke-dashoffset="${DIAL_C.toFixed(1)}" transform="rotate(-90 60 60)"/>` +
    // The gnomon: centre pin to the plate edge, tapering as a real style does.
    `<g class="isle-dial-gnomon">` +
    `<line x1="60" y1="58" x2="60" y2="13" stroke="${IVORY}" stroke-width="1.2"` +
    ` stroke-linecap="round" opacity="0.42"/>` +
    `<line x1="60" y1="60" x2="60" y2="40" stroke="${IVORY}" stroke-width="1.9"` +
    ` stroke-linecap="round" opacity="0.34"/>` +
    `</g>` +
    `<circle cx="60" cy="60" r="1.6" fill="${IVORY}" opacity="0.45"/>` +
    `</svg>`
  )
}

/**
 * The goat, sketched in charcoal.
 *
 * Line-art rules that make it read as hand-drawn rather than clip-art:
 * a turbulence-displacement filter wobbles every stroke; the main outline
 * gets a faint offset second pass (the sketcher finding the line); shading
 * is four hatch strokes, not a fill; and the sea-foam swirl on the flank —
 * the one marking the player just saw — is there as a light spiral, because
 * the sketch is *of that goat*. It looks back over its shoulder the way it
 * looked at the player.
 */
function goatSketchSvg(): string {
  const w = (width: number, opacity: number, extra = '') =>
    `fill="none" stroke="${CHARCOAL}" stroke-width="${width}" opacity="${opacity}"` +
    ` stroke-linecap="round" stroke-linejoin="round" ${extra}`
  return (
    `<svg viewBox="0 0 260 210" aria-hidden="true">` +
    `<defs><filter id="isleGoatRough" x="-8%" y="-8%" width="116%" height="116%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="2" seed="11" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="2.8"/>` +
    `</filter></defs>` +
    `<g filter="url(#isleGoatRough)">` +
    // Faint second pass first, so the confident line sits on top of it.
    `<path d="M68 86 C 98 67, 150 63, 179 80 C 191 88, 193 101, 185 113" ${w(2, 0.2)} transform="translate(2,-1.5)"/>` +
    `<path d="M52 58 C 44 60, 36 70, 30 80" ${w(2, 0.2)} transform="translate(1.5,1)"/>` +
    // Back and rump — one long stroke, the spine of the drawing.
    `<path d="M66 84 C 96 66, 150 62, 178 78 C 190 86, 192 100, 184 112" ${w(2.5, 0.85)}/>` +
    // Belly, drawn lighter and left open at both ends, the sketcher's shorthand.
    `<path d="M84 106 C 106 118, 142 120, 166 112" ${w(2.2, 0.6)}/>` +
    // Chest.
    `<path d="M64 88 C 60 96, 62 104, 74 108" ${w(2.2, 0.7)}/>` +
    // Neck up to the crown.
    `<path d="M66 84 C 60 74, 56 66, 52 58" ${w(2.4, 0.85)}/>` +
    // Forehead down to the snout, the nose curl, and the jaw back up.
    `<path d="M52 58 C 44 60, 36 70, 30 80" ${w(2.4, 0.85)}/>` +
    `<path d="M30 80 C 27 84, 29 89, 36 89" ${w(2.4, 0.85)}/>` +
    `<path d="M36 89 C 44 91, 52 88, 58 84" ${w(2.2, 0.75)}/>` +
    // The little smile nick and a nostril.
    `<path d="M31 84 Q 35 87 40 86" ${w(1.7, 0.6)}/>` +
    `<circle cx="32" cy="80.5" r="0.9" fill="${CHARCOAL}" opacity="0.7"/>` +
    // Beard — two quick flicks.
    `<path d="M40 91 L 37 101 M45 92 L 43 101" ${w(1.9, 0.65)}/>` +
    // Horns, slightly unequal, curving back.
    `<path d="M54 56 C 57 46, 63 39, 73 38 C 77 38, 80 40, 81 43" ${w(2.1, 0.8)}/>` +
    `<path d="M50 55 C 51 44, 56 36, 64 33 C 68 32, 71 33, 72 35" ${w(2.1, 0.8)}/>` +
    // Ear, back-swept.
    `<path d="M58 62 C 70 57, 79 59, 83 66 C 76 69, 66 68, 60 66" ${w(2, 0.75)}/>` +
    // The eye — looking back at you.
    `<circle cx="46" cy="68" r="2" fill="${CHARCOAL}" opacity="0.9"/>` +
    // Legs with quick flat hoof dashes.
    `<path d="M80 108 L 78 148 M74 148 L 84 148" ${w(2.3, 0.8)}/>` +
    `<path d="M94 110 L 93 146 M88 146 L 98 146" ${w(2.1, 0.65)}/>` +
    `<path d="M160 112 C 166 122, 162 134, 158 148 M153 148 L 163 148" ${w(2.3, 0.8)}/>` +
    `<path d="M174 106 C 178 118, 178 132, 176 144 M171 144 L 181 144" ${w(2.1, 0.65)}/>` +
    // Tail flick.
    `<path d="M182 80 C 192 70, 198 74, 192 84" ${w(2.2, 0.8)}/>` +
    // The sea-foam swirl, sketched — the marking that names this exact goat.
    `<path d="M141 92 A 12 12 0 1 1 129 80 A 8 8 0 1 1 121 88 A 4.5 4.5 0 1 1 126 92" ${w(1.9, 0.5)}/>` +
    // Hatching under the belly and along the neck — charcoal shading.
    `<path d="M98 112 l 8 -10 M106 114 l 8 -10 M114 116 l 8 -10 M122 116 l 8 -10" ${w(1.5, 0.3)}/>` +
    `<path d="M60 78 l 6 -8 M66 76 l 6 -8" ${w(1.5, 0.3)}/>` +
    // A tuft of grass by the mouth — what it came for.
    `<path d="M26 92 l -3 9 M30 93 l 0 9 M34 93 l 3 8" ${w(1.6, 0.45)}/>` +
    // Ground — two loose scribbles.
    `<path d="M62 154 Q 100 159 140 155 T 204 156" ${w(1.8, 0.28)}/>` +
    `<path d="M78 159 Q 110 162 150 159" ${w(1.6, 0.2)}/>` +
    `</g>` +
    `</svg>`
  )
}

/* ======================================================================
 * Stylesheet. Injected once; everything scoped under .isle-el / the two
 * body-class rules the contract names. styles.css is never touched.
 * ==================================================================== */

function injectStyles(): void {
  if (document.getElementById('isle-opening-css')) return
  const style = document.createElement('style')
  style.id = 'isle-opening-css'
  style.textContent = `
/* ---------- chrome hiding ----------
 * Mirrors body.panel-open's selector shape exactly (see styles.css: the #ui
 * hop is what outranks per-ID opacity rules). Composes with panel-open and
 * cinematic: all three write the same hidden state, so any combination of
 * them keeps chrome hidden, and removing one while another holds changes
 * nothing — a settings panel opened mid-opening cannot resurrect the HUD. */
body.isle-opening #ui .hud-chrome {
  opacity: 0;
  pointer-events: none !important;
}

/* The settings glyph — the spec's one visible piece of chrome, at 40%, and
 * only once revealSettings() has stamped body.isle-settings (beat 3). Until
 * then it inherits the hide above, so the wake frame is genuinely naked.
 * Double-ID specificity beats every class-shaped hide rule; the :not()
 * guards hand it back to panel-open and the letterbox when those are up. The
 * long fade is deliberate — chrome that pops into a quiet beach announces
 * itself; chrome that resolves over a second and a half is just there. */
body.isle-opening.isle-settings:not(.panel-open):not(.cinematic) #ui #menuBtn {
  opacity: 0.4;
  pointer-events: auto !important;
  transition: opacity 1.5s ease;
}

/* ...and stripped back to a glyph while it is here.
 *
 * Opacity alone was not enough. The valley's settings button is a cream token
 * with a saturated cyan gear on it, authored to hold its own against a bright
 * green farm — and cyan is the one hue the opening's palette does not contain
 * anywhere. At 40% over a dark jungle wall it still read as the only cool
 * thing on screen and the only element with a hard-edged rounded-rect plate,
 * which is to say it read as an app pasted over a beach. Losing the well and
 * the cyan leaves a warm ivory glyph: findable if you look for it, invisible
 * if you are looking at the island. The valley gets its token back the moment
 * body.isle-opening comes off. */
body.isle-opening #ui #menuBtn {
  background: none !important;
  box-shadow: none !important;
  border-color: transparent !important;
}
body.isle-opening #ui #menuBtn .nav-ico {
  /* Grayscale kills the cyan; sepia+brightness lands it on the palette's
   * linen (#E8DECC) rather than on a grey that would read as dead UI. */
  filter: grayscale(1) sepia(0.45) brightness(1.3) drop-shadow(0 1px 2px rgba(30, 22, 12, 0.5));
}

/* ---------- opening layer ---------- */
#isleOpening {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 24;
  transition: opacity 0.8s ease;
}
#isleOpening.isle-retire { opacity: 0; }

/* ---------- prompt: pulse circle + verb ----------
 * Both rings here are *ground* rings — update() gives them a scaleY that
 * flattens them into the sand, so nothing in this block may set its own
 * transform on .isle-pulse / .isle-mark. Ripples animate scale via a nested
 * element instead, which composes with the parent's squash for free. */
.isle-prompt {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  transition: opacity ${PROMPT_FADE}s ease;
  will-change: transform;
}
.isle-prompt.born { opacity: 1; }
.isle-prompt.nopos .isle-pulse { display: none; }

.isle-pulse {
  position: absolute;
  left: 0;
  top: 0;
  /* Fallback only — update() overwrites this inline with the squash appended.
     It exists so the very first frame after setPrompt is centred, not
     top-left, in case a frame renders before the next update(). */
  transform: translate(-50%, -50%);
}
/* The resting ring: one hairline, breathing on a four-second cycle — closer
   to a held breath than a pulse. */
.isle-pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(239, 227, 200, 0.44);
  box-shadow: 0 0 9px rgba(239, 227, 200, 0.1);
  animation: isleBreatheRing 4.4s ease-in-out infinite;
}
@keyframes isleBreatheRing {
  0%, 100% { transform: scale(0.975); opacity: 0.8; }
  50%      { transform: scale(1.03);  opacity: 1; }
}

.isle-pulse i,
.isle-mark i {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(239, 227, 200, 0.55);
  animation: isleRing 4.4s ease-out infinite;
}
/* Half-phase apart: one ripple ever really visible, every 2.2s. */
.isle-pulse i:nth-child(2),
.isle-mark i:nth-child(2) { animation-delay: 2.2s; }
@keyframes isleRing {
  0%   { transform: scale(0.72); opacity: 0; }
  16%  { opacity: 0.42; }
  100% { transform: scale(1.3); opacity: 0; }
}

/* The verbs. Small, widely spaced, warm off-white — an instruction the island
   would rather not have had to give. text-indent pays back the trailing
   letter-space so the word stays optically centred under translate(-50%). */
.isle-verb {
  position: absolute;
  left: 0;
  top: 0;
  color: rgba(243, 234, 214, 0.9);
  font-weight: 500;
  font-size: clamp(14px, 1.6vw, 19px);
  letter-spacing: 0.22em;
  text-indent: 0.22em;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(36, 26, 12, 0.5), 0 0 14px rgba(26, 18, 8, 0.42);
  animation: isleBreathe 4.6s ease-in-out infinite;
}
@keyframes isleBreathe {
  0%, 100% { opacity: 0.82; }
  50%      { opacity: 1; }
}

/* String #2 — the one sentence the game says all session. The journal's
   italic hand, a slower breath, and a fade twice as long at both ends. */
.isle-prompt.poem { transition: opacity ${POEM_FADE}s ease; }
.isle-prompt.poem .isle-verb {
  font-style: italic;
  font-weight: 400;
  font-size: clamp(18px, 2.1vw, 25px);
  letter-spacing: 0.07em;
  text-indent: 0.07em;
  color: rgba(242, 233, 213, 0.95);
  /* This line lands on bright ivory sand, where ivory type would vanish. It
     keeps its light weight and buys contrast from a soft dark halo instead —
     three shadows widening out to a vignette, never an outline. */
  text-shadow:
    0 1px 2px rgba(26, 18, 8, 0.6),
    0 0 16px rgba(28, 19, 8, 0.6),
    0 0 38px rgba(28, 19, 8, 0.45);
  animation: isleBreathe 6.4s ease-in-out infinite;
}

/* The verb steps aside while the gesture bubble is up: the card carries the
   same word, and two of them is two prompts. The animation has to be cancelled
   as well as the opacity set — a running keyframe outranks the property. */
.isle-prompt.hushed .isle-verb {
  animation: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}

/* ---------- gesture bubble ----------
 * A small linen card held above the object on a tail, carrying the verb it
 * already had plus a picture of the gesture. The wrapper is placed by update()
 * at the *tail's tip*; the card hangs above that point, which is what keeps
 * the thing being pointed at uncovered at every camera distance. Nothing here
 * may write the wrapper's transform — that is the frame's to own — so the
 * born transition lives on the card instead. */
.isle-bubble {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
}
.isle-bub-card {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 8px 14px;
  white-space: nowrap;
  border: 1.5px solid rgba(184, 160, 118, 0.85);
  /* Four unequal corners, as everywhere else on this island's paper: a cut
     card, never a preset. */
  border-radius: 13px 16px 12px 15px;
  /* The journal's weave, at card scale: two nearly invisible crossed grains
     over the linen. One at a time they are nothing; together they are the
     difference between a piece of paper and a rounded rectangle. */
  background:
    repeating-linear-gradient(
      8deg,
      rgba(120, 96, 62, 0.05) 0 1px,
      rgba(255, 250, 236, 0.05) 1px 3px
    ),
    repeating-linear-gradient(
      96deg,
      rgba(120, 96, 62, 0.04) 0 1px,
      rgba(255, 250, 236, 0.04) 1px 3.5px
    ),
    radial-gradient(90% 120% at 16% 8%, rgba(255, 250, 238, 0.5), transparent 60%),
    linear-gradient(168deg, #e6dbc2 0%, #e0d4b8 56%, #d5c7a5 100%);
  box-shadow:
    0 3px 11px rgba(50, 34, 15, 0.3),
    inset 0 1px 0 rgba(255, 251, 240, 0.5);
  opacity: 0;
  transform: translate(-50%, calc(-100% - ${BUBBLE_TAIL}px)) scale(0.86);
  /* Grown from the tail, so it unfolds out of the object it points at. */
  transform-origin: 50% 118%;
  transition: opacity ${PROMPT_FADE}s ease, transform ${PROMPT_FADE}s var(--spring);
}
.isle-bubble.born .isle-bub-card {
  opacity: 1;
  transform: translate(-50%, calc(-100% - ${BUBBLE_TAIL}px)) scale(1);
}

.isle-bub-tail {
  position: absolute;
  left: 50%;
  bottom: -8px;
  line-height: 0;
  /* update() rewrites this when the card is pushed off a screen edge. */
  transform: translate(-50%, 0);
}
.isle-bubble.nopos .isle-bub-tail { display: none; }

/* Verb over bar, left-aligned to each other: the fill starts under the word's
   first letter, so the bar reads as that verb's progress rather than as a
   gauge that happens to share a card with it. */
.isle-bub-text {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}

/* Same hush as the prompt's verb — small, widely spaced — but charcoal ink,
   because it is now sitting on paper rather than on a dark beach. */
.isle-bub-verb {
  color: rgba(63, 56, 48, 0.9);
  font-weight: 600;
  font-size: clamp(13px, 1.45vw, 17px);
  letter-spacing: 0.16em;
  text-indent: 0.16em;
}

/* ---------- the hold bar ----------
 * The track is the important half. An empty inset groove, dark enough to read
 * as a hole in the card at a glance, is what turns a growing yellow line into
 * *a bar with somewhere left to go* — without it the fill is just a mark
 * appearing, and the player learns nothing about how long to keep holding.
 * 10px tall and 96px long: chunky by the standards of everything else in this
 * file, and deliberately so, because it is the one element here whose whole
 * job is to be understood instantly by someone who is confused. */
.isle-bub-bar {
  display: none;
  position: relative;
  height: 10px;
  min-width: 96px;
  border-radius: 999px;
  /* Deep enough to read as a hole cut in the card. The yellow cannot be pushed
     any further toward saturation without entering lotto gold's exclusion
     radius, so the contrast has to be bought on the *track* side instead —
     a darker groove makes the same butter yellow read brighter beside it. */
  background: linear-gradient(180deg, rgba(48, 38, 20, 0.46), rgba(48, 38, 20, 0.28));
  box-shadow:
    inset 0 1.5px 2.5px rgba(34, 25, 10, 0.5),
    inset 0 -1px 0 rgba(255, 251, 238, 0.34);
  overflow: hidden;
}
.isle-bubble.hold .isle-bub-bar { display: block; }

/* The fill. Width, not scaleX — a scaled bar squashes its own round cap into
   an ellipse and the leading edge stops looking like an edge. overflow:hidden
   clips the highlight below to the cap's curve, and also means a zero-progress
   bar draws literally nothing rather than a 3px nub sitting at the left. */
.isle-bub-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  overflow: hidden;
  border-radius: 999px;
  /* The lit band is kept to the top third on purpose. Carried to the middle it
     reads as a cream bar with a yellow underside, and the one thing this
     element cannot afford to be is ambiguous about its own colour. */
  background: linear-gradient(180deg, ${BAR_YELLOW_HI} 0%, ${BAR_YELLOW} 30%, ${BAR_YELLOW} 100%);
  box-shadow: 0 0 6px rgba(248, 234, 136, 0.5);
  /* Duration is rewritten per call: fast up, slow down. */
  transition: width ${BAR_FILL_MS}ms linear;
}
/* The leading edge — a brighter lip at the front of the fill, so the bar has a
   head that is visibly travelling rather than a block that is getting longer. */
.isle-bub-fill::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 999px;
  background: ${BAR_YELLOW_HI};
  box-shadow: 0 0 5px rgba(253, 247, 200, 0.9);
}

/* Full. One short snap — the bar swells, the fill blooms, and both settle — so
   completion is felt at the bar rather than only in the world. Latched in
   writeBar(), so it fires once and re-arms only after progress leaves the top.
   The bloom is a *filter* on the same yellow rather than a swapped-in pale
   background: a background override holds for as long as the class is latched,
   which turned the finished bar permanently cream — the completed state has to
   end up looking like a full version of the bar you were just filling. */
.isle-bub-bar.full { animation: isleBarSnap 0.4s cubic-bezier(0.2, 0.8, 0.3, 1); }
.isle-bub-bar.full .isle-bub-fill { animation: isleBarFlash 0.4s ease-out; }
@keyframes isleBarFlash {
  0%   { filter: none; }
  18%  { filter: brightness(1.2); }
  100% { filter: none; }
}
@keyframes isleBarSnap {
  0%   { transform: scaleY(1); box-shadow: inset 0 1.5px 2px rgba(38, 28, 12, 0.45); }
  26%  {
    transform: scaleY(1.32);
    box-shadow: 0 0 13px rgba(253, 247, 200, 0.85), inset 0 1.5px 2px rgba(38, 28, 12, 0.2);
  }
  100% { transform: scaleY(1); box-shadow: inset 0 1.5px 2px rgba(38, 28, 12, 0.45); }
}

.isle-bub-gest {
  width: 33px;
  height: 33px;
  flex: none;
}
.isle-bub-gest svg {
  display: block;
  width: 100%;
  height: 100%;
}
.isle-bub-glyph {
  transform-box: fill-box;
  transform-origin: center;
}

/* Idle hold: the glyph breathes a slow squeeze — the shape of a press, before
   there is a press. The moment progress is live it stops and simply stays
   pressed, so the only thing moving is the ring filling. */
.isle-bub-gest.hold .isle-bub-glyph {
  animation: isleHoldSqueeze 1.9s ease-in-out infinite;
}
.isle-bub-gest.hold.pressing .isle-bub-glyph {
  animation: none;
  transform: scale(0.9);
  transition: transform 0.18s ease;
}
@keyframes isleHoldSqueeze {
  0%, 100% { transform: scale(1); }
  46%      { transform: scale(0.9); }
}

/* Tap: the glyph knocks once and two rings leave it, half a cycle apart. */
.isle-bub-gest.tap .isle-bub-glyph {
  animation: isleTapKnock 1.7s ease-out infinite;
}
.isle-bub-rip {
  transform-box: fill-box;
  transform-origin: center;
  animation: isleTapRipple 1.7s ease-out infinite;
}
/* Negative, not positive: a positive delay leaves the second ring sitting at
   its base opacity of zero for the first second of its life, so a bubble that
   appears and is looked at immediately shows one ripple instead of a rhythm.
   Started half a cycle in the past, there is always a ring in flight. */
.isle-bub-rip.r2 { animation-delay: -0.85s; }
@keyframes isleTapKnock {
  0%   { transform: scale(1); }
  7%   { transform: scale(0.88); }
  18%  { transform: scale(1); }
  100% { transform: scale(1); }
}
@keyframes isleTapRipple {
  0%   { transform: scale(0.48); opacity: 0; }
  14%  { opacity: 0.5; }
  100% { transform: scale(1.2); opacity: 0; }
}

/* ---------- standalone marker ---------- */
.isle-mark {
  position: absolute;
  left: 0;
  top: 0;
  margin: 0;
  opacity: 0;
  transition: opacity ${PROMPT_FADE}s ease;
  will-change: transform;
}
.isle-mark.born { opacity: 0.7; }

/* ---------- sundial ----------
 * Wrapper opacity is the born/retire transition; the inner <svg>'s opacity is
 * written per frame as the crop grows, so the two never fight. */
.isle-sundial {
  position: absolute;
  left: 0;
  top: 0;
  opacity: 0;
  transition: opacity 0.9s ease;
  will-change: transform;
}
.isle-sundial.born { opacity: 0.85; }
.isle-sundial svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  /* A soft shadow, never an outline: it holds the hairlines together over
     pale sand without ever drawing a dark edge around them. No transition —
     update() writes this element's opacity every frame already. */
  filter: drop-shadow(0 1px 1.5px rgba(42, 30, 14, 0.35));
}

/* ---------- satchel ----------
 * Small, matte, cornered. It is the only thing on screen for most of the
 * opening, so it earns its place by being quiet: linen card, hairline edge,
 * a shadow you would have to look for. */
.isle-satchel {
  position: fixed;
  left: max(14px, env(safe-area-inset-left, 0px));
  bottom: max(14px, env(safe-area-inset-bottom, 0px));
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  background: rgba(238, 229, 209, 0.88);
  border: 1.5px solid rgba(191, 169, 128, 0.8);
  border-radius: 15px;
  box-shadow: 0 2px 7px rgba(58, 40, 18, 0.16);
  opacity: 0;
  transform: scale(0.3);
  pointer-events: none;
}
/* The birth: the pouch lands, the card takes the hit and settles, and one
   ivory halo opens off the edge — the same ring language as every marker,
   used once, to say *this is now yours*. */
.isle-satchel.born {
  animation: islePop 0.62s var(--spring) forwards;
}
.isle-satchel::after {
  content: '';
  position: absolute;
  inset: -5px;
  border-radius: 19px;
  border: 1.5px solid rgba(239, 227, 200, 0.75);
  opacity: 0;
  pointer-events: none;
}
.isle-satchel.born::after {
  animation: isleHalo 1.05s cubic-bezier(0.2, 0.7, 0.3, 1) 0.1s forwards;
}
@keyframes islePop {
  0%   { opacity: 0; transform: scale(0.3); }
  56%  { opacity: 1; transform: scale(1.12); }
  78%  { transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes isleHalo {
  0%   { opacity: 0.8; transform: scale(0.72); }
  100% { opacity: 0; transform: scale(1.5); }
}

.isle-fly {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 26;
  transition: transform ${FLY_SECONDS}s cubic-bezier(0.45, -0.05, 0.22, 1);
  filter: drop-shadow(0 3px 4px rgba(30, 20, 8, 0.35));
}

/* ---------- seed chip & blips ---------- */
.isle-seedchip {
  position: fixed;
  left: calc(max(14px, env(safe-area-inset-left, 0px)) + 62px);
  bottom: calc(max(14px, env(safe-area-inset-bottom, 0px)) + 13px);
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  background: rgba(238, 229, 209, 0.88);
  border: 1.5px solid rgba(191, 169, 128, 0.8);
  border-radius: 999px;
  color: #55402a;
  font-weight: 600;
  font-size: 14px;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 6px rgba(58, 40, 18, 0.14);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.4s ease, transform 0.4s var(--spring);
}
.isle-seedchip.born { opacity: 1; transform: translateY(0); }
.isle-seedchip svg { display: block; }

.isle-bliprail {
  position: fixed;
  left: calc(max(14px, env(safe-area-inset-left, 0px)) + 8px);
  bottom: calc(max(14px, env(safe-area-inset-bottom, 0px)) + 62px);
  width: 90px;
}
/* Blips are a receipt, not an announcement: linen ink on smoke, gone in a
   second and a half, drifting up out of the way of the beach. */
.isle-blip {
  position: absolute;
  left: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  background: rgba(34, 26, 15, 0.4);
  border-radius: 999px;
  color: rgba(232, 222, 204, 0.92);
  font-weight: 600;
  font-size: 12px;
  animation: isleBlip 1.5s ease-out forwards;
}
.isle-blip i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  opacity: 0.9;
}
@keyframes isleBlip {
  0%   { opacity: 0; transform: translateY(7px) scale(0.85); }
  14%  { opacity: 1; transform: translateY(0) scale(1.04); }
  24%  { transform: translateY(-2px) scale(1); }
  66%  { opacity: 1; }
  100% { opacity: 0; transform: translateY(-24px) scale(0.95); }
}

/* ---------- journal ---------- */
.isle-journal {
  position: fixed;
  inset: 0;
  z-index: 28;
  display: grid;
  place-items: center;
  pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(26, 19, 10, 0.24), rgba(26, 19, 10, 0.44));
  opacity: 0;
  transition: opacity 0.45s ease;
}
.isle-journal.born { opacity: 1; }

/* Linen, not paper-white: the page is cut from the same cloth as the pouch
   and the avatar's shirt (#E8DECC), tea-stained toward its edges and pulled a
   couple of steps down in value — the first pass sat so close to white that on
   a bright beach it read as a system dialog.

   The two repeating gradients at the top of the stack are the weave. They are
   nearly invisible one at a time (3.5% ink on a 3px period) and that is the
   point: a woven surface does not announce itself, it just refuses to be flat,
   and refusing to be flat is the entire difference between paper and a div.
   Crossed at 8° and 96° rather than 0/90 so the grain never lines up with the
   page edges or the pixel grid. */
.isle-page {
  position: relative;
  width: min(80vw, 620px);
  min-height: min(62vh, 420px);
  padding: clamp(18px, 4vmin, 34px) clamp(20px, 4.5vmin, 40px) clamp(56px, 9vmin, 74px);
  padding-left: clamp(38px, 7vmin, 62px);
  display: flex;
  align-items: center;
  gap: clamp(12px, 3vmin, 28px);
  background:
    repeating-linear-gradient(
      8deg,
      rgba(120, 96, 62, 0.05) 0 1px,
      rgba(255, 250, 236, 0.05) 1px 3px
    ),
    repeating-linear-gradient(
      96deg,
      rgba(120, 96, 62, 0.045) 0 1px,
      rgba(255, 250, 236, 0.04) 1px 3.5px
    ),
    radial-gradient(120% 90% at 18% 12%, rgba(160, 132, 88, 0.2), transparent 55%),
    radial-gradient(70% 60% at 86% 78%, rgba(132, 102, 64, 0.2), transparent 60%),
    radial-gradient(24% 20% at 70% 22%, rgba(126, 96, 58, 0.14), transparent 70%),
    linear-gradient(168deg, #e4d8be 0%, #dccfb0 54%, #cbb994 100%);
  /* Four different corner radii and no two edges alike: cut card, not preset. */
  border-radius: 7px 16px 9px 20px;
  box-shadow:
    0 4px 12px rgba(52, 36, 16, 0.2),
    0 22px 50px rgba(28, 19, 8, 0.3),
    inset 0 0 52px rgba(132, 102, 64, 0.24);
  /* Held, not mounted: a shallow perspective turn plus the tilt. The sheet
     leans away at the binding, which is what a bound page does when the book
     is open in someone's lap. */
  transform: perspective(1200px) rotateY(2.6deg) rotate(-1.5deg) translateY(10px) scale(0.96);
  transition: transform 0.5s var(--spring);
}
.isle-journal.born .isle-page {
  transform: perspective(1200px) rotateY(2.6deg) rotate(-1.5deg) translateY(0) scale(1);
}

/* The curl: the page darkens into the binding and catches a little light at
   the outer edge, which is the shading that sells the warp above. */
.isle-page::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      rgba(96, 74, 44, 0.3) 0,
      rgba(96, 74, 44, 0.08) 5%,
      transparent 14%,
      transparent 88%,
      rgba(255, 251, 238, 0.16) 100%
    );
}

/* The binding: a strip of darker cloth down the left edge with the thread
   showing through it. Two rows of dashes offset half a period apart, which is
   how a saddle stitch actually looks — one thread over, one thread under. */
.isle-bind {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: clamp(20px, 3.6vmin, 32px);
  border-radius: inherit;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  background:
    linear-gradient(90deg, rgba(104, 80, 48, 0.26), rgba(104, 80, 48, 0.04) 62%, transparent);
  pointer-events: none;
}
.isle-bind::before,
.isle-bind::after {
  content: '';
  position: absolute;
  top: 5%;
  bottom: 5%;
  width: 0;
  border-left: 1.5px dashed rgba(86, 66, 40, 0.5);
}
.isle-bind::before { left: 34%; }
/* Half a dash out of phase with the row beside it — the stitch crossing over. */
.isle-bind::after {
  left: 58%;
  border-left-style: dashed;
  border-left-color: rgba(86, 66, 40, 0.32);
  top: 8%;
  bottom: 8%;
}

.isle-sketch {
  position: relative;
  flex: 1.5;
  min-width: 0;
}
.isle-sketch svg {
  width: 100%;
  height: auto;
  display: block;
}

/* The heel of the hand, dragged across the drawing while it was being made.
   Multiply, not overlay: charcoal dust sits *in* the fibre and darkens it, and
   the smudge has to lose its own edge into the weave or it reads as a shape
   somebody drew on purpose. */
.isle-smudge,
.isle-smear {
  position: absolute;
  pointer-events: none;
  mix-blend-mode: multiply;
}
.isle-smudge {
  left: 8%;
  bottom: 6%;
  width: 46%;
  height: 30%;
  transform: rotate(-9deg);
  background: radial-gradient(
    58% 50% at 42% 50%,
    rgba(63, 56, 48, 0.17),
    rgba(63, 56, 48, 0.06) 62%,
    transparent 82%
  );
  filter: blur(3px);
}
/* One quick streak away from the smudge — the direction the hand travelled. */
.isle-smear {
  right: 12%;
  top: 22%;
  width: 26%;
  height: 9%;
  transform: rotate(6deg);
  background: linear-gradient(
    100deg,
    transparent,
    rgba(63, 56, 48, 0.11) 38%,
    rgba(63, 56, 48, 0.05) 74%,
    transparent
  );
  filter: blur(2.5px);
}

/* The empty want-slot — a pencilled-in frame waiting for something. */
.isle-want {
  flex: 0.9;
  aspect-ratio: 1;
  max-width: 150px;
  align-self: center;
  border: 2px dashed rgba(74, 66, 56, 0.42);
  border-radius: 14px;
  background: radial-gradient(60% 60% at 50% 50%, rgba(110, 88, 56, 0.06), transparent 75%);
  transform: rotate(1.6deg);
}

.isle-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: clamp(16px, 3.5vmin, 28px);
  text-align: center;
  color: ${CHARCOAL};
  opacity: 0.82;
  font-weight: 500;
  font-size: clamp(17px, 2.2vw, 24px);
  letter-spacing: 0.06em;
  font-style: italic;
}
`
  document.head.appendChild(style)
}
