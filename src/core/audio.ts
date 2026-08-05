/**
 * Game audio.
 *
 * Ones-hot SFX prefer ElevenLabs samples under `public/sfx/` (decoded into
 * AudioBuffers). If a sample is missing or fails to load, the old WebAudio
 * synth still plays so nothing goes silent. Day BGM is Harvest Path; night BGM
 * is Moonlit Turnip Row. Rain uses a looping sample faded against weather.
 *
 * Browsers block audio until a user gesture, so the context starts suspended
 * and resumes on the first click or keypress.
 */

import { asset } from './assets'

/* A matched pair: the day theme, and its own after-dark version. */
const MUSIC_DAY = asset('audio/lagoon-lanterns.mp3')
const MUSIC_NIGHT = asset('audio/moonlit-lagoon-loop.mp3')
/** Seconds to crossfade when day/night flips. */
const MUSIC_XFADE = 1.6

/** Same night window as the ambience track. */
function isNightHour(hour: number) {
  return hour >= 20.5 || hour < 4.5
}

/** Root notes per part of day, as semitone offsets from A. Dawn and dusk sit
 *  a fourth apart so the shift is audible without being jarring. */
const DAY_ROOTS = [
  { until: 5, root: -5, mode: 'night' },
  { until: 9, root: 0, mode: 'dawn' },
  { until: 17, root: 2, mode: 'day' },
  { until: 21, root: -3, mode: 'dusk' },
  { until: 24, root: -5, mode: 'night' },
] as const

function midiToHz(semitonesFromA4: number) {
  return 440 * Math.pow(2, semitonesFromA4 / 12)
}

export type Sfx =
  | 'till'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'coin'
  | 'levelup'
  | 'rare'
  | 'epic'
  | 'click'
  | 'error'
  | 'hatch'
  | 'pop'
  | 'greet'
  | 'greet-girl'
  | 'instant-grow'
  | 'step-grass-1'
  | 'step-grass-2'
  | 'step-dirt-1'
  | 'step-dirt-2'
  | 'buy'
  | 'sell'
  | 'open'
  | 'dismiss'
  | 'place'
  | 'collect'

/** Sample path per oneshot. Rain is handled separately as a loop. */
const SFX_SAMPLES: Record<Sfx, string> = {
  till: 'sfx/till.mp3',
  plant: 'sfx/plant.mp3',
  water: 'sfx/water.mp3',
  harvest: 'sfx/harvest.mp3',
  coin: 'sfx/coin.mp3',
  levelup: 'sfx/levelup.mp3',
  rare: 'sfx/rare.mp3',
  epic: 'sfx/epic.mp3',
  click: 'sfx/click.mp3',
  error: 'sfx/error.mp3',
  hatch: 'sfx/hatch.mp3',
  pop: 'sfx/pop.mp3',
  greet: 'sfx/greet.mp3',
  'greet-girl': 'sfx/greet-girl.mp3',
  'instant-grow': 'sfx/instant-grow.mp3',
  'step-grass-1': 'sfx/step-grass-1.mp3',
  'step-grass-2': 'sfx/step-grass-2.mp3',
  'step-dirt-1': 'sfx/step-dirt-1.mp3',
  'step-dirt-2': 'sfx/step-dirt-2.mp3',
  buy: 'sfx/buy.mp3',
  sell: 'sfx/sell.mp3',
  open: 'sfx/open.mp3',
  dismiss: 'sfx/dismiss.mp3',
  place: 'sfx/place.mp3',
  collect: 'sfx/collect.mp3',
}

export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  /** Decoded oneshot samples. Missing entries fall back to the synth. */
  private readonly buffers = new Map<Sfx, AudioBuffer>()
  private rainBuf: AudioBuffer | null = null
  private rainSrc: AudioBufferSourceNode | null = null
  private rainGain: GainNode | null = null
  private raining = false

  muted = false
  private hiddenSuspended = false
  private started = false

  /**
   * Mix levels, 0..1. Stored independently of the gain nodes because the
   * AudioContext does not exist until the first user gesture — settings
   * restored from disk have to survive until then and be applied on start.
   */
  masterVolume = 0.9
  musicVolume = 0.16
  sfxVolume = 0.55

  /** True when the game must be silent regardless of the Sound toggle. */
  private isSilent() {
    return this.muted || this.hiddenSuspended
  }

  private refreshMaster() {
    this.applyGain(this.master, this.isSilent() ? 0 : this.masterVolume)
  }

  /**
   * The tab went to the background.
   *
   * Its own flag rather than folding into `muted`, so restoring silence on the
   * way back cannot clobber whatever the player had the Sound toggle set to.
   *
   * The game itself keeps running — `visibilitychange` in main.ts credits the
   * time away as offline growth — but a farming game singing to an empty tab is
   * the kind of thing that gets a browser tab hunted down and closed.
   */
  suspendForHidden() {
    this.hiddenSuspended = true
    this.refreshMaster()
    this.syncSoundtrack()
    void this.ctx?.suspend()
  }

  /**
   * Back in the tab: sound resumes immediately, with no fresh click needed.
   *
   * Autoplay policy only demands a gesture to *unlock* the context in the first
   * place. Once unlocked, a resume on returning is allowed — and waiting for a
   * click before the music comes back is a silence the player reads as broken.
   */
  resumeFromHidden() {
    this.hiddenSuspended = false
    this.refreshMaster()
    if (!this.isSilent()) void this.ctx?.resume()
    this.syncSoundtrack()
  }

  private hour = 12
  /** Day / night loops, each with its own bus gain for crossfades. */
  private dayEl: HTMLAudioElement | null = null
  private nightEl: HTMLAudioElement | null = null
  private dayBus: GainNode | null = null
  private nightBus: GainNode | null = null
  /** True when the night loop is the active (or fading-in) track. */
  private musicNight = false
  /** Graph wiring failed — fall back to element.volume on a single el. */
  private musicGraphOk = false

  constructor() {
    // Any gesture unlocks audio. Once is enough, so the listeners remove
    // themselves.
    const unlock = () => this.start()
    addEventListener('pointerdown', unlock, { once: true })
    addEventListener('keydown', unlock, { once: true })
  }

  private start() {
    if (this.started) return
    this.started = true

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.isSilent() ? 0 : this.masterVolume
    this.master.connect(this.ctx.destination)
    if (this.hiddenSuspended) void this.ctx.suspend()

    // Music sits well under SFX — it is background, and the player needs to
    // hear the coin chime over it without ducking.
    this.musicGain = this.ctx.createGain()
    this.musicGain.gain.value = this.musicVolume
    this.musicGain.connect(this.master)

    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = this.sfxVolume
    this.sfxGain.connect(this.master)

    this.rainGain = this.ctx.createGain()
    this.rainGain.gain.value = 0
    this.rainGain.connect(this.sfxGain)

    this.startSoundtrack()
    void this.loadSamples()
  }

  /** Decode every oneshot + the rain bed. Failures leave that id on synth. */
  private async loadSamples() {
    const ctx = this.ctx
    if (!ctx) return
    await Promise.all(
      (Object.entries(SFX_SAMPLES) as [Sfx, string][]).map(async ([id, path]) => {
        try {
          const res = await fetch(asset(path))
          if (!res.ok) return
          const raw = await res.arrayBuffer()
          const buf = await ctx.decodeAudioData(raw.slice(0))
          this.buffers.set(id, buf)
        } catch {
          /* keep synth fallback */
        }
      }),
    )
    try {
      const res = await fetch(asset('sfx/rain.mp3'))
      if (res.ok) {
        const raw = await res.arrayBuffer()
        this.rainBuf = await ctx.decodeAudioData(raw.slice(0))
        if (this.raining) this.syncRain(true)
      }
    } catch {
      /* no rain bed */
    }
  }

  /** Play a decoded sample through the SFX bus. Returns false if unavailable. */
  private playSample(id: Sfx, gain = 1, rate = 1): boolean {
    const ctx = this.ctx
    const buf = this.buffers.get(id)
    if (!ctx || !this.sfxGain || !buf) return false
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(this.sfxGain)
    src.start()
    return true
  }

  /** Fade the looping rain bed in/out with weather. */
  setRaining(on: boolean) {
    this.raining = on
    this.syncRain(on)
  }

  private syncRain(on: boolean) {
    const ctx = this.ctx
    if (!ctx || !this.rainGain) return
    const now = ctx.currentTime
    this.rainGain.gain.cancelScheduledValues(now)
    this.rainGain.gain.setValueAtTime(this.rainGain.gain.value, now)
    if (!on || this.isSilent()) {
      this.rainGain.gain.linearRampToValueAtTime(0, now + 0.8)
      window.setTimeout(() => {
        if (!this.raining || this.isSilent()) {
          this.rainSrc?.stop()
          this.rainSrc = null
        }
      }, 900)
      return
    }
    if (!this.rainBuf) return
    if (!this.rainSrc) {
      const src = ctx.createBufferSource()
      src.buffer = this.rainBuf
      src.loop = true
      src.connect(this.rainGain)
      src.start()
      this.rainSrc = src
    }
    this.rainGain.gain.linearRampToValueAtTime(0.35, now + 1.2)
  }

  private makeLoop(src: string): HTMLAudioElement {
    // Use createElement — this class is also named Audio, so `new Audio()`
    // would construct the game wrapper, not HTMLAudioElement.
    const el = document.createElement('audio')
    el.src = src
    el.loop = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    return el
  }

  /** Hook day + night loops into the music bus. */
  private startSoundtrack() {
    if (!this.ctx || !this.musicGain || this.dayEl) return

    this.dayEl = this.makeLoop(MUSIC_DAY)
    this.nightEl = this.makeLoop(MUSIC_NIGHT)
    this.musicNight = isNightHour(this.hour)

    this.dayBus = this.ctx.createGain()
    this.nightBus = this.ctx.createGain()
    this.dayBus.gain.value = this.musicNight ? 0 : 1
    this.nightBus.gain.value = this.musicNight ? 1 : 0
    this.dayBus.connect(this.musicGain)
    this.nightBus.connect(this.musicGain)

    try {
      this.ctx.createMediaElementSource(this.dayEl).connect(this.dayBus)
      this.ctx.createMediaElementSource(this.nightEl).connect(this.nightBus)
      this.musicGraphOk = true
    } catch {
      // Fallback: play one element straight to speakers.
      this.musicGraphOk = false
      const el = this.musicNight ? this.nightEl : this.dayEl
      el.volume = this.musicVolume
    }

    this.syncSoundtrack()
  }

  /** Crossfade (or hard-swap on fallback) to the track for the current hour. */
  private ensureTrack() {
    const wantNight = isNightHour(this.hour)
    if (wantNight === this.musicNight) return
    this.musicNight = wantNight

    if (!this.musicGraphOk || !this.ctx || !this.dayBus || !this.nightBus) {
      // Single-element fallback: pause both, play the active one.
      this.dayEl?.pause()
      this.nightEl?.pause()
      const el = wantNight ? this.nightEl : this.dayEl
      if (el) {
        el.volume = this.musicVolume
        if (!this.isSilent()) void el.play().catch(() => {})
      }
      return
    }

    const now = this.ctx.currentTime
    const rising = wantNight ? this.nightBus : this.dayBus
    const falling = wantNight ? this.dayBus : this.nightBus
    const risingEl = wantNight ? this.nightEl : this.dayEl
    const fallingEl = wantNight ? this.dayEl : this.nightEl

    if (risingEl && !this.isSilent()) void risingEl.play().catch(() => {})

    falling.gain.cancelScheduledValues(now)
    rising.gain.cancelScheduledValues(now)
    falling.gain.setValueAtTime(falling.gain.value, now)
    rising.gain.setValueAtTime(rising.gain.value, now)
    falling.gain.linearRampToValueAtTime(0, now + MUSIC_XFADE)
    rising.gain.linearRampToValueAtTime(1, now + MUSIC_XFADE)

    // Pause the faded-out loop after the crossfade so it isn't decoding forever.
    if (fallingEl) {
      window.setTimeout(() => {
        if (this.musicNight === wantNight) fallingEl.pause()
      }, MUSIC_XFADE * 1000 + 50)
    }
  }

  /** Pause/resume loops to match mute / hidden-tab state. */
  private syncSoundtrack() {
    if (!this.dayEl || !this.nightEl) return
    if (this.isSilent()) {
      this.dayEl.pause()
      this.nightEl.pause()
      return
    }
    this.ensureTrack()
    const active = this.musicNight ? this.nightEl : this.dayEl
    void active.play().catch(() => {
      /* Autoplay can still refuse until another gesture; update() retries. */
    })
  }

  toggleMute() {
    this.setMuted(!this.muted)
    return this.muted
  }

  setMuted(muted: boolean) {
    this.muted = muted
    // A hidden tab still wins — the toggle only stores the preference.
    this.refreshMaster()
    this.syncSoundtrack()
    this.syncRain(this.raining && !this.isSilent())
  }

  setMasterVolume(v: number) {
    this.masterVolume = clamp01(v)
    this.refreshMaster()
  }

  setMusicVolume(v: number) {
    this.musicVolume = clamp01(v)
    this.applyGain(this.musicGain, this.musicVolume)
    // Fallback path (no MediaElementSource) uses the element volume directly.
    if (!this.musicGraphOk) {
      const el = this.musicNight ? this.nightEl : this.dayEl
      if (el) el.volume = this.musicVolume
    }
  }

  setSfxVolume(v: number) {
    this.sfxVolume = clamp01(v)
    this.applyGain(this.sfxGain, this.sfxVolume)
  }

  /** Ramp rather than snap — an instant gain change clicks audibly. */
  private applyGain(node: GainNode | null, value: number) {
    if (!node || !this.ctx) return
    node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.04)
  }

  setHour(hour: number) {
    this.hour = hour
    if (this.started) this.ensureTrack()
  }

  private currentRoot() {
    for (const entry of DAY_ROOTS) {
      if (this.hour < entry.until) return entry
    }
    return DAY_ROOTS[DAY_ROOTS.length - 1]
  }

  // --- synth primitives ---------------------------------------------------

  /** A single enveloped oscillator note. */
  private tone(
    freq: number,
    opts: {
      type?: OscillatorType
      at?: number
      duration?: number
      gain?: number
      attack?: number
      dest?: AudioNode
      detune?: number
      sweepTo?: number
    } = {},
  ) {
    const ctx = this.ctx
    if (!ctx) return

    const at = opts.at ?? ctx.currentTime
    const duration = opts.duration ?? 0.25
    const attack = opts.attack ?? 0.008
    const peak = opts.gain ?? 0.3

    const osc = ctx.createOscillator()
    osc.type = opts.type ?? 'sine'
    osc.frequency.setValueAtTime(freq, at)
    if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), at + duration)
    if (opts.detune) osc.detune.value = opts.detune

    const env = ctx.createGain()
    // Exponential decay to a tiny floor, not to zero — ramping to exactly 0
    // is undefined for exponentialRampToValueAtTime and clicks.
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(peak, at + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    osc.connect(env)
    env.connect(opts.dest ?? this.sfxGain ?? ctx.destination)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }

  /** Filtered noise burst — soil, water, rustle. */
  private noise(
    opts: { at?: number; duration?: number; gain?: number; freq?: number; q?: number; type?: BiquadFilterType; sweepTo?: number } = {},
  ) {
    const ctx = this.ctx
    if (!ctx) return

    const at = opts.at ?? ctx.currentTime
    const duration = opts.duration ?? 0.2

    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1

    const src = ctx.createBufferSource()
    src.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = opts.type ?? 'bandpass'
    filter.frequency.setValueAtTime(opts.freq ?? 900, at)
    if (opts.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), at + duration)
    filter.Q.value = opts.q ?? 1

    const env = ctx.createGain()
    env.gain.setValueAtTime(opts.gain ?? 0.3, at)
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration)

    src.connect(filter)
    filter.connect(env)
    env.connect(this.sfxGain ?? ctx.destination)
    src.start(at)
    src.stop(at + duration)
  }

  // --- sound effects ------------------------------------------------------

  /**
   * `opts` exists for sounds that repeat.
   *
   * A sample played back identically twenty times in ten seconds is the most
   * grating thing a game can do, and the ear objects to the *sameness* rather
   * than the volume. Nudging the playback rate is enough to break it up;
   * nothing else here needs to change.
   */
  play(sfx: Sfx, opts: { gain?: number; rate?: number } = {}) {
    const ctx = this.ctx
    if (!ctx || this.isSilent()) return
    // Prefer the recorded clip; synth stays as a silent-failure fallback.
    if (this.playSample(sfx, opts.gain ?? 1, opts.rate ?? 1)) return
    const now = ctx.currentTime
    const root = this.currentRoot().root

    switch (sfx) {
      case 'till':
        // Dull thud plus a scrape of loose earth.
        this.noise({ duration: 0.22, freq: 320, sweepTo: 120, gain: 0.35, q: 0.7 })
        this.tone(90, { type: 'sine', duration: 0.14, gain: 0.25, sweepTo: 55 })
        break

      case 'plant':
        this.noise({ duration: 0.12, freq: 700, gain: 0.16, q: 1.4 })
        this.tone(midiToHz(root + 12), { type: 'triangle', duration: 0.16, gain: 0.16 })
        break

      case 'water':
        // Rising bandpass on noise reads as a pour.
        this.noise({ duration: 0.5, freq: 500, sweepTo: 2200, gain: 0.22, q: 2.2 })
        break

      case 'harvest':
        // Short two-note pluck up a fourth.
        this.tone(midiToHz(root + 7), { type: 'triangle', duration: 0.13, gain: 0.26 })
        this.tone(midiToHz(root + 12), { type: 'triangle', at: now + 0.06, duration: 0.18, gain: 0.22 })
        this.noise({ duration: 0.1, freq: 1600, gain: 0.1, q: 2 })
        break

      case 'coin':
        this.tone(1180, { type: 'square', duration: 0.07, gain: 0.12 })
        this.tone(1760, { type: 'square', at: now + 0.05, duration: 0.11, gain: 0.1 })
        break

      case 'levelup': {
        // Rising arpeggio through the scale, then an octave to land on.
        const notes = [0, 4, 7, 12]
        notes.forEach((n, i) => {
          this.tone(midiToHz(root + n + 12), {
            type: 'triangle', at: now + i * 0.08, duration: 0.3, gain: 0.24,
          })
        })
        this.tone(midiToHz(root + 24), { type: 'sine', at: now + 0.34, duration: 0.6, gain: 0.18 })
        break
      }

      case 'rare': {
        const notes = [0, 5, 9]
        notes.forEach((n, i) =>
          this.tone(midiToHz(root + n + 24), { type: 'sine', at: now + i * 0.05, duration: 0.5, gain: 0.16 }),
        )
        break
      }

      case 'epic': {
        // A whole shimmering chord plus a sub thump for weight.
        const notes = [0, 4, 7, 11, 14, 19]
        notes.forEach((n, i) =>
          this.tone(midiToHz(root + n + 12), {
            type: 'sine', at: now + i * 0.04, duration: 1.4, gain: 0.15, detune: (i % 2 ? 6 : -6),
          }),
        )
        this.tone(midiToHz(root - 12), { type: 'sine', duration: 0.9, gain: 0.3 })
        break
      }

      case 'hatch':
        this.noise({ duration: 0.18, freq: 2400, sweepTo: 600, gain: 0.2, q: 1.2 })
        this.tone(midiToHz(root + 12), { type: 'triangle', at: now + 0.1, duration: 0.2, gain: 0.22 })
        this.tone(midiToHz(root + 19), { type: 'triangle', at: now + 0.22, duration: 0.35, gain: 0.2 })
        break

      case 'click':
        this.tone(880, { type: 'square', duration: 0.04, gain: 0.07 })
        break

      case 'pop':
        this.tone(520, { type: 'sine', duration: 0.09, gain: 0.16, sweepTo: 900 })
        break

      case 'error':
        this.tone(180, { type: 'sawtooth', duration: 0.18, gain: 0.14, sweepTo: 120 })
        break

      case 'buy':
        this.tone(880, { type: 'square', duration: 0.06, gain: 0.1 })
        this.tone(1320, { type: 'square', at: now + 0.06, duration: 0.1, gain: 0.09 })
        break
      case 'sell':
        this.tone(990, { type: 'square', duration: 0.05, gain: 0.1 })
        this.tone(1320, { type: 'square', at: now + 0.05, duration: 0.08, gain: 0.09 })
        this.tone(1760, { type: 'square', at: now + 0.11, duration: 0.12, gain: 0.08 })
        break
      case 'open':
        this.noise({ duration: 0.12, freq: 900, sweepTo: 400, gain: 0.12, q: 0.8 })
        break
      case 'dismiss':
        this.tone(720, { type: 'triangle', duration: 0.08, gain: 0.12 })
        break
      case 'place':
        this.noise({ duration: 0.14, freq: 280, sweepTo: 120, gain: 0.22, q: 0.7 })
        this.tone(110, { type: 'sine', duration: 0.12, gain: 0.18 })
        break
      case 'collect':
        this.tone(660, { type: 'triangle', duration: 0.1, gain: 0.14, sweepTo: 880 })
        break
    }
  }

  /**
   * Keep the soundtrack running after unlock. Retries play() if the browser
   * blocked the first attempt (common until a second gesture).
   */
  update() {
    if (!this.started || !this.dayEl || !this.nightEl) return
    if (this.isSilent()) {
      if (!this.dayEl.paused) this.dayEl.pause()
      if (!this.nightEl.paused) this.nightEl.pause()
      return
    }
    this.ensureTrack()
    const active = this.musicNight ? this.nightEl : this.dayEl
    if (active.paused) this.syncSoundtrack()
  }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
