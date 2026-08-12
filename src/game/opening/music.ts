import { asset } from '../../core/assets'
import type { Audio } from '../../core/audio'

/**
 * Opening music — one composition, three vertical layers (spec §Music).
 *
 * The score is a single 20-second theme authored as three stems that share a
 * length and a tempo: L1 is solo ukulele/slack-key over the wave bed, L2 adds
 * the mandolin (culture arriving as order is made), L3 is the full warm theme.
 * Layers never *play* independently — all three loop from the same instant and
 * the arrangement changes purely by gain, so the mandolin enters mid-phrase in
 * perfect time instead of restarting the tune.
 *
 * That is why these are `AudioBufferSourceNode`s on the game's one
 * AudioContext (the rain-bed pattern in audio.ts) and NOT `HTMLAudioElement`s:
 * media elements each run their own clock and drift apart within a minute,
 * while buffer sources started at the same `ctx.currentTime` are sample-locked
 * forever. A hidden tab suspends the whole context, so even backgrounding
 * cannot desynchronise them.
 *
 * MP3 is a lossy container with encoder padding, so a "20 s" file can decode
 * to 20.05 s with a trailing whisper of silence — loop that and every pass
 * adds a hiccup, and worse, three stems with *different* padding drift apart
 * one hiccup at a time. `start()` therefore trims each decoded buffer back to
 * its last audible sample and then loops ALL THREE at the single shortest
 * trimmed length, keeping the phase lock across loop boundaries too.
 *
 * Lifecycle (wired by W-INT):
 *   start()            beat-1 completion — the wake tap doubles as the audio
 *                      unlock gesture, so the context may still be a frame or
 *                      two from existing; start() politely retries until it is.
 *   enterLayer(2)      pocket cleared — lands together with island's breath.
 *   enterLayer(3)      first ordinary tomato picked.
 *   fadeToGameMusic()  handover — stems out over 3 s while the normal
 *                      day/night soundtrack resumes underneath (a crossfade).
 *
 * The built-in lagoon soundtrack would otherwise start at the same unlock
 * gesture and play underneath the stems, so start() parks it via the additive
 * `Audio.setSoundtrackSuppressed` switch and fadeToGameMusic() releases it.
 */

/** The three stems, quietest arrangement first. Authored to a common 20 s. */
const STEM_PATHS = [
  'audio/opening-l1.mp3',
  'audio/opening-l2.mp3',
  'audio/opening-l3.mp3',
] as const

/** Seconds for a newly entered layer to swell in. Musical, not instant. */
const LAYER_RAMP = 2

/** Seconds for the whole bed to bow out at handover. */
const FADE_OUT = 3

/** L1's fade-in at the wake tap — a hard start would read as a UI sound. */
const START_RAMP = 0.8

/** Samples quieter than this count as trailing encoder silence. */
const TRIM_THRESHOLD = 0.001

/** How often start() re-checks for the AudioContext while it is still null. */
const CTX_POLL_MS = 120

/** Trailing-silence trim: seconds from buffer start to the last audible sample. */
function audibleLength(buf: AudioBuffer): number {
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > TRIM_THRESHOLD) {
        // First audible channel wins — stems are mixed together anyway, and
        // scanning the rest could only *lengthen* the loop with near-silence.
        return (i + 1) / buf.sampleRate
      }
    }
  }
  return buf.duration
}

export class OpeningMusic {
  private readonly audio: Audio
  /** Raw file bytes, fetched eagerly so the wake tap decodes, not downloads. */
  private readonly raw: (ArrayBuffer | null)[] = [null, null, null]
  private readonly fetching: Promise<void>
  private gains: GainNode[] | null = null
  private sources: AudioBufferSourceNode[] | null = null
  private starting = false
  private started = false
  private fadedOut = false
  /** Layers requested before the stems were audible; applied once they are. */
  private readonly pendingLayers = new Set<2 | 3>()

  constructor(audio: Audio) {
    this.audio = audio
    // Fetch all three stems now — decode needs the (gesture-gated) context,
    // but the network does not, and the first note should land on the tap.
    this.fetching = Promise.all(
      STEM_PATHS.map(async (path, i) => {
        try {
          const res = await fetch(asset(path))
          if (res.ok) this.raw[i] = await res.arrayBuffer()
        } catch {
          /* missing stem: that layer simply never sounds — non-fatal */
        }
      }),
    ).then(() => undefined)
  }

  /**
   * Begin the bed: decode the stems and start all three loops at one shared
   * `ctx.currentTime`, L1 audible, L2/L3 silent. Idempotent. Safe to call in
   * the same frame as the unlocking gesture — if the context does not exist
   * yet it retries on a short timer rather than failing.
   */
  start(): void {
    if (this.starting || this.fadedOut) return
    this.starting = true
    // Park the lagoon loops before they get a chance to start under us.
    this.audio.setSoundtrackSuppressed(true)
    this.whenReady()
  }

  private whenReady(): void {
    if (this.fadedOut) return
    const ctx = this.audio.ctx
    if (!ctx) {
      window.setTimeout(() => this.whenReady(), CTX_POLL_MS)
      return
    }
    void this.fetching.then(() => this.begin(ctx))
  }

  private async begin(ctx: AudioContext): Promise<void> {
    if (this.started || this.fadedOut) return
    this.started = true

    const buffers: (AudioBuffer | null)[] = await Promise.all(
      this.raw.map(async (bytes) => {
        if (!bytes) return null
        try {
          // slice(): decodeAudioData detaches its input, and a retry after a
          // transient failure would otherwise find an empty buffer.
          return await ctx.decodeAudioData(bytes.slice(0))
        } catch {
          return null
        }
      }),
    )
    if (this.fadedOut) return
    const live = buffers.filter((b): b is AudioBuffer => b !== null)
    if (live.length === 0) {
      // Nothing decoded: give the music bus back rather than holding silence.
      this.audio.setSoundtrackSuppressed(false)
      return
    }

    // One shared loop length for every stem — differing per-file trims would
    // let the loops slip one padding-width apart per pass.
    const loopEnd = Math.min(...live.map(audibleLength))

    const bus = this.audio.musicBus
    const t0 = ctx.currentTime + 0.08
    this.gains = []
    this.sources = []

    buffers.forEach((buf, i) => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(bus)
      this.gains!.push(gain)
      if (!buf) return

      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      src.loopStart = 0
      src.loopEnd = Math.min(loopEnd, buf.duration)
      src.connect(gain)
      src.start(t0)
      this.sources!.push(src)

      if (i === 0) {
        gain.gain.setValueAtTime(0, t0)
        gain.gain.linearRampToValueAtTime(1, t0 + START_RAMP)
      }
    })

    for (const n of this.pendingLayers) this.rampLayer(n)
    this.pendingLayers.clear()
  }

  /**
   * Bring a stem in: 2 = mandolin (pocket cleared), 3 = full theme (first
   * harvest). Swells over ~2 s mid-phrase — the loops are already running in
   * phase, so the entrance is always in time. Idempotent; order-tolerant.
   */
  enterLayer(n: 2 | 3): void {
    if (this.fadedOut) return
    if (!this.gains) {
      this.pendingLayers.add(n)
      return
    }
    this.rampLayer(n)
  }

  private rampLayer(n: 2 | 3): void {
    const ctx = this.audio.ctx
    const gain = this.gains?.[n - 1]
    if (!ctx || !gain) return
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(1, now + LAYER_RAMP)
  }

  /**
   * Handover: stems fade out over 3 s and the normal day/night soundtrack
   * resumes immediately underneath, giving the crossfade for free. Terminal —
   * the opening never restarts within a page lifetime.
   */
  fadeToGameMusic(): void {
    if (this.fadedOut) return
    this.fadedOut = true
    this.pendingLayers.clear()

    // Release the built-in soundtrack first so it rises under the stems.
    this.audio.setSoundtrackSuppressed(false)

    const ctx = this.audio.ctx
    if (!ctx || !this.gains) return
    const now = ctx.currentTime
    for (const gain of this.gains) {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + FADE_OUT)
    }
    const sources = this.sources
    const gains = this.gains
    this.sources = null
    this.gains = null
    window.setTimeout(() => {
      for (const src of sources ?? []) {
        try {
          src.stop()
        } catch {
          /* already stopped */
        }
      }
      for (const gain of gains ?? []) gain.disconnect()
    }, FADE_OUT * 1000 + 100)
  }
}
