/**
 * Unified portal adapter — CrazyGames SDK v3 (+ Playgama Bridge v2 if present).
 *
 * Game code only ever calls `platform.*`. Never touch `window.CrazyGames` /
 * `window.bridge` outside this file. Standalone = silent no-ops.
 */

export type PlatformMode = 'cg' | 'pg' | 'none'

export interface PlatformHooks {
  onAudioSuspend?: () => void
  onAudioResume?: () => void
  onGamePause?: () => void
  onGameResume?: () => void
}

type CgSdk = {
  init: () => Promise<void>
  environment: 'local' | 'crazygames' | 'disabled'
  game: {
    settings: { muteAudio?: boolean; disableChat?: boolean }
    addSettingsChangeListener: (fn: (s: { muteAudio?: boolean }) => void) => void
    loadingStart: () => void
    loadingStop: () => void
    gameplayStart: () => void
    gameplayStop: () => void
    happytime: () => void
    setGameContext: (obj: Record<string, unknown>) => void
  }
  ad: {
    requestAd: (
      type: 'midgame' | 'rewarded',
      cbs: { adStarted: () => void; adFinished: () => void; adError: (err: unknown) => void },
    ) => void
    hasAdblock: () => Promise<boolean>
  }
  data: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
}

type PgBridge = {
  initialize: () => Promise<void>
  setGameLoadingProgress: (n: number) => void
  platform: {
    isAudioEnabled: boolean
    isPaused: boolean
    sendMessage: (msg: string) => void
    on: (event: string, fn: (...args: unknown[]) => void) => void
  }
  advertisement: {
    isRewardedSupported: boolean
    showInterstitial: (placement?: string) => void
    showRewarded: (placement?: string) => void
    on: (event: string, fn: (state: string) => void) => void
    off: (event: string, fn: (state: string) => void) => void
  }
  storage: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void> | void
    delete: (key: string) => Promise<void> | void
  }
  EVENT_NAME: {
    AUDIO_STATE_CHANGED: string
    PAUSE_STATE_CHANGED: string
    REWARDED_STATE_CHANGED: string
  }
}

const noop = () => {}

let mode: PlatformMode = 'none'
let CG: CgSdk | null = null
let PG: PgBridge | null = null

declare global {
  interface Window {
    CrazyGames?: { SDK: CgSdk }
    bridge?: PgBridge
  }
}

export const platform = {
  mode: 'none' as PlatformMode,

  /** Wired by the game after init — CrazyGames ads need explicit mute/pause. */
  _onAdStart: noop as () => void,
  _onAdEnd: noop as () => void,

  /** True when progress must go through the portal Data module, not localStorage. */
  usesCloudSave() {
    return mode === 'cg' || mode === 'pg'
  },

  async init(hooks: PlatformHooks = {}) {
    const h = {
      onAudioSuspend: noop,
      onAudioResume: noop,
      onGamePause: noop,
      onGameResume: noop,
      ...hooks,
    }

    // ---- CrazyGames ----
    CG = typeof window !== 'undefined' ? window.CrazyGames?.SDK ?? null : null
    if (CG) {
      try {
        await CG.init()
        // On non-portal domains environment is 'disabled' and every call throws.
        // `local` (localhost) and `crazygames` are both valid for SDK use.
        if (CG.environment === 'disabled') {
          CG = null
        } else {
          mode = 'cg'
          this.mode = mode
          try {
            CG.game.loadingStart()
          } catch {
            /* ignore */
          }
          // Portal mute overrides the in-game toggle. Apply initial value,
          // then subscribe (the listener only fires on later changes).
          const applyMute = (s: { muteAudio?: boolean } | null | undefined) =>
            (s?.muteAudio ? h.onAudioSuspend : h.onAudioResume)()
          try {
            applyMute(CG.game.settings)
          } catch {
            /* ignore */
          }
          try {
            CG.game.addSettingsChangeListener(applyMute)
          } catch {
            /* ignore */
          }
          return
        }
      } catch {
        CG = null
      }
    }

    // ---- Playgama (optional — only if the bridge script is present) ----
    PG = typeof window !== 'undefined' ? window.bridge ?? null : null
    if (PG) {
      try {
        await PG.initialize()
        mode = 'pg'
        this.mode = mode
        const applyAudio = (enabled: unknown) =>
          (enabled ? h.onAudioResume : h.onAudioSuspend)()
        try {
          applyAudio(PG.platform.isAudioEnabled)
        } catch {
          /* ignore */
        }
        try {
          PG.platform.on(PG.EVENT_NAME.AUDIO_STATE_CHANGED, applyAudio)
        } catch {
          /* ignore */
        }
        const applyPause = (paused: unknown) =>
          (paused ? h.onGamePause : h.onGameResume)()
        try {
          applyPause(PG.platform.isPaused)
        } catch {
          /* ignore */
        }
        try {
          PG.platform.on(PG.EVENT_NAME.PAUSE_STATE_CHANGED, applyPause)
        } catch {
          /* ignore */
        }
        return
      } catch {
        PG = null
      }
    }

    mode = 'none'
    this.mode = mode
  },

  // ---------- loading ----------
  setLoadingProgress(p: number) {
    if (mode === 'pg') {
      try {
        PG!.setGameLoadingProgress(Math.round(Math.max(0, Math.min(1, p)) * 100))
      } catch {
        /* ignore */
      }
    }
  },

  loadComplete() {
    if (mode === 'cg') {
      try {
        CG!.game.loadingStop()
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        PG!.platform.sendMessage('game_ready')
      } catch {
        /* ignore */
      }
    }
  },

  // ---------- gameplay lifecycle ----------
  gameplayStart() {
    if (mode === 'cg') {
      try {
        CG!.game.gameplayStart()
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        PG!.platform.sendMessage('level_started')
      } catch {
        /* ignore */
      }
    }
  },

  gameplayStop() {
    if (mode === 'cg') {
      try {
        CG!.game.gameplayStop()
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        PG!.platform.sendMessage('level_paused')
      } catch {
        /* ignore */
      }
    }
  },

  happytime() {
    if (mode === 'cg') {
      try {
        CG!.game.happytime()
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        PG!.platform.sendMessage('player_got_achievement')
      } catch {
        /* ignore */
      }
    }
  },

  setGameContext(obj: Record<string, unknown>) {
    if (mode === 'cg') {
      try {
        CG!.game.setGameContext(obj)
      } catch {
        /* ignore */
      }
    }
  },

  /**
   * Midgame / rewarded video. Off for CrazyGames Basic Launch (monetization
   * disabled). Flip to true for Full Launch — both entry points honour it, and
   * rewardedAvailable() hides every "watch an ad" button while this is false.
   */
  adsEnabled: false,

  // ---------- interstitial ----------
  showInterstitial(_placement = 'next_level') {
    if (!this.adsEnabled || mode === 'none') return
    if (mode === 'cg') {
      try {
        CG!.ad.requestAd('midgame', {
          adStarted: () => {
            this._onAdStart()
          },
          adFinished: () => {
            this._onAdEnd()
          },
          adError: () => {
            // Must still resume — a failed request leaves the player muted/paused
            // if we only unwind on adFinished.
            this._onAdEnd()
          },
        })
      } catch {
        this._onAdEnd()
      }
    } else if (mode === 'pg') {
      try {
        PG!.advertisement.showInterstitial(_placement)
      } catch {
        /* ignore */
      }
    }
  },

  // ---------- rewarded ----------
  rewardedAvailable() {
    if (!this.adsEnabled) return false
    if (mode === 'cg') return true
    if (mode === 'pg') {
      try {
        return !!PG!.advertisement.isRewardedSupported
      } catch {
        return false
      }
    }
    return false
  },

  showRewarded(onReward: () => void = noop, onClose: (ok: boolean) => void = noop) {
    if (!this.adsEnabled || mode === 'none') {
      onClose(false)
      return
    }
    if (mode === 'cg') {
      try {
        CG!.ad.requestAd('rewarded', {
          adStarted: () => {
            this._onAdStart()
          },
          adFinished: () => {
            this._onAdEnd()
            onReward()
            onClose(true)
          },
          adError: () => {
            this._onAdEnd()
            onClose(false)
          },
        })
      } catch {
        onClose(false)
      }
    } else if (mode === 'pg') {
      let rewarded = false
      const handler = (state: string) => {
        if (state === 'rewarded') {
          rewarded = true
          onReward()
        } else if (state === 'closed' || state === 'failed') {
          try {
            PG!.advertisement.off(PG!.EVENT_NAME.REWARDED_STATE_CHANGED, handler)
          } catch {
            /* ignore */
          }
          onClose(rewarded)
        }
      }
      try {
        PG!.advertisement.on(PG!.EVENT_NAME.REWARDED_STATE_CHANGED, handler)
        PG!.advertisement.showRewarded()
      } catch {
        onClose(false)
      }
    } else {
      onClose(false)
    }
  },

  // ---------- save data ----------
  async loadSave(key: string): Promise<unknown | null> {
    if (mode === 'cg') {
      try {
        const raw = CG!.data.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }
    if (mode === 'pg') {
      try {
        return await PG!.storage.get(key)
      } catch {
        return null
      }
    }
    return null
  },

  persistSave(key: string, obj: unknown) {
    if (mode === 'cg') {
      try {
        CG!.data.setItem(key, JSON.stringify(obj))
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        void PG!.storage.set(key, obj)
      } catch {
        /* ignore */
      }
    }
  },

  clearSave(key: string) {
    if (mode === 'cg') {
      try {
        CG!.data.removeItem(key)
      } catch {
        /* ignore */
      }
    } else if (mode === 'pg') {
      try {
        void PG!.storage.delete(key)
      } catch {
        /* ignore */
      }
    }
  },
}
