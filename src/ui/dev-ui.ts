/**
 * Developer panel. Backquote (`) toggles it; `?dev` in the URL opens it at
 * boot for touch devices with no backquote to press.
 *
 * Floating and draggable by its title bar, with the position remembered. It was
 * pinned bottom-left, which is fine until the thing you are testing is *also*
 * bottom-left — the hotbar, the controls card, the plot menu — and then the
 * panel is sitting on top of the only evidence you have. Being able to shove it
 * out of the way is most of what makes it usable during a real session.
 *
 * Deliberately styled as a tool, not as game UI — monospace, dark, dense.
 * Making it pretty would invite leaving it reachable in production; making it
 * ugly keeps its status honest. It talks to the game exclusively through the
 * callback bag below, so it can never grow a private line into game state
 * that the real UI doesn't have.
 */

export interface DevActions {
  /** Set the clock to an hour of the day (0-24). */
  setHour(h: number): void
  skipDay(): void
  setWeather(type: string): void
  /** Grant coins / xp. */
  give(kind: 'coins' | 'xp', amount: number): void
  levelUp(): void
  /** Jump straight to a level (clamped to the game's range by the handler). */
  setLevel(level: number): void
  growAll(): void
  waterAll(): void
  setQuality(q: 'low' | 'medium' | 'high'): void
  teleport(where: 'farm' | 'square' | 'barn'): void
  /** Force a contextual tip card on screen (QA). */
  showTip(): void
  /** Restart the first-time tour from step 1 (QA). */
  restartFtue(): void
  /** Wipe the save and reload into a brand new game. */
  resetSave(): void
  /** Save right now, without waiting for the autosave tick. */
  saveNow(): void
  /** Fell the opening stand outright, creating the farm. */
  openClearing(): void
  /** Put the beach seed crates back, for testing the opening. */
  respawnCrates(): void
  /** Widen the farm clearing by one ring. */
  expandPlot(): void
  /** Force every level-gated building into the world regardless of level. */
  revealAll(): void
  /** Live render stats for the readout line. */
  stats(): { fps: number; calls: number; tris: number; quality: string }
}

const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'meteor', 'bloodmoon', 'disco']

export class DevUi {
  private readonly root: HTMLDivElement
  private readonly statsLine: HTMLDivElement
  open = false

  constructor(private readonly actions: DevActions) {
    this.root = document.createElement('div')
    this.root.id = 'devPanel'
    this.root.style.display = 'none'

    /*
     * Title bar doubles as the drag handle.
     *
     * Dragging the panel body instead would mean every button press starts a
     * drag, and a one-pixel wobble between mousedown and mouseup then reads as
     * a drag rather than a click — the buttons would feel broken about a third
     * of the time.
     */
    const bar = document.createElement('div')
    bar.className = 'dev-bar'
    bar.textContent = 'dev'
    const close = document.createElement('button')
    close.className = 'dev-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.toggle())
    bar.append(close)
    this.root.append(bar)
    this.makeDraggable(bar)

    const btn = (label: string, run: () => void) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', run)
      return b
    }
    /** A button that destroys progress. Coloured so it cannot be hit absently. */
    const danger = (label: string, run: () => void) => {
      const b = btn(label, run)
      b.className = 'dev-danger'
      return b
    }
    const row = (title: string, ...els: HTMLElement[]) => {
      const r = document.createElement('div')
      r.className = 'dev-row'
      const t = document.createElement('span')
      t.className = 'dev-label'
      t.textContent = title
      r.append(t, ...els)
      return r
    }

    // Time: one button per notable hour beats a slider — the hours that matter
    // for testing (noon light, dusk grade, raid window) are discrete.
    this.root.append(
      row(
        'time',
        btn('6am', () => actions.setHour(6)),
        btn('noon', () => actions.setHour(12)),
        btn('6pm', () => actions.setHour(18)),
        btn('11pm', () => actions.setHour(23)),
        btn('+day', () => actions.skipDay()),
      ),
    )

    const weatherRow = row('wthr')
    for (const w of WEATHERS) weatherRow.append(btn(w, () => actions.setWeather(w)))
    this.root.append(weatherRow)

    // Level: presets for the gate thresholds worth testing (each unlocks a
    // feature), plus a free-typed setter for anything else.
    const levelInput = document.createElement('input')
    levelInput.type = 'number'
    levelInput.min = '1'
    levelInput.max = '19'
    levelInput.placeholder = 'lvl'
    const levelRow = row(
      'level',
      btn('1', () => actions.setLevel(1)),
      btn('3', () => actions.setLevel(3)),
      btn('5', () => actions.setLevel(5)),
      btn('8', () => actions.setLevel(8)),
      btn('12', () => actions.setLevel(12)),
      btn('max', () => actions.setLevel(99)),
      levelInput,
      btn('set', () => {
        const n = Number(levelInput.value)
        if (Number.isFinite(n) && n >= 1) actions.setLevel(n)
      }),
    )
    this.root.append(levelRow)

    this.root.append(
      row(
        'give',
        btn('+1k coins', () => actions.give('coins', 1000)),
        btn('+100 xp', () => actions.give('xp', 100)),
        btn('level up', () => actions.levelUp()),
      ),
      row(
        'farm',
        btn('grow all', () => actions.growAll()),
        btn('water all', () => actions.waterAll()),
      ),
      row(
        'gfx',
        btn('low', () => actions.setQuality('low')),
        btn('med', () => actions.setQuality('medium')),
        btn('high', () => actions.setQuality('high')),
      ),
      row(
        'goto',
        btn('farm', () => actions.teleport('farm')),
        btn('square', () => actions.teleport('square')),
        btn('barn', () => actions.teleport('barn')),
      ),
      row(
        'ui',
        btn('tip', () => actions.showTip()),
        btn('ftue', () => actions.restartFtue()),
      ),
      /*
       * The opening, which is the hardest thing in the game to test by playing:
       * every step of it is one-way, so without these the only way back to the
       * beach is a save wipe and a five-minute replay.
       */
      row(
        'open',
        btn('clear trees', () => actions.openClearing()),
        btn('respawn crates', () => actions.respawnCrates()),
        btn('+plot ring', () => actions.expandPlot()),
        btn('reveal all', () => actions.revealAll()),
      ),
      /*
       * Destructive, so it is last and it asks. A stray click on "wipe" during a
       * long test session costs exactly the session it was meant to help.
       */
      row(
        'save',
        btn('save now', () => actions.saveNow()),
        danger('WIPE + reload', () => {
          if (confirm('Delete the save and start a new game?')) actions.resetSave()
        }),
      ),
    )

    this.statsLine = document.createElement('div')
    this.statsLine.className = 'dev-stats'
    this.root.append(this.statsLine)

    document.getElementById('ui')!.appendChild(this.root)
    this.restorePosition()

    if (new URLSearchParams(location.search).has('dev')) this.toggle()
  }

  /** Where the panel was left, so it does not jump back every reload. */
  private static readonly POS_KEY = 'sv-dev-pos'

  private restorePosition() {
    try {
      const raw = localStorage.getItem(DevUi.POS_KEY)
      if (!raw) return
      const { x, y } = JSON.parse(raw) as { x: number; y: number }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      this.moveTo(x, y)
    } catch {
      /* no stored position, or storage is off */
    }
  }

  /**
   * Position from the top-left, clamped so the panel can never be dragged
   * somewhere it cannot be dragged back from.
   */
  private moveTo(x: number, y: number) {
    const w = this.root.offsetWidth || 320
    const h = this.root.offsetHeight || 200
    const cx = Math.max(0, Math.min(innerWidth - Math.min(w, 120), x))
    const cy = Math.max(0, Math.min(innerHeight - 28, y))
    this.root.style.left = `${cx}px`
    this.root.style.top = `${cy}px`
    this.root.style.right = 'auto'
    this.root.style.bottom = 'auto'
    void h
  }

  private makeDraggable(handle: HTMLElement) {
    let dx = 0
    let dy = 0
    const onMove = (e: PointerEvent) => this.moveTo(e.clientX - dx, e.clientY - dy)
    const onUp = () => {
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', onUp)
      try {
        localStorage.setItem(
          DevUi.POS_KEY,
          JSON.stringify({ x: this.root.offsetLeft, y: this.root.offsetTop }),
        )
      } catch {
        /* storage off; the panel still drags, it just forgets */
      }
    }
    handle.addEventListener('pointerdown', (e) => {
      // Not the close button, which lives in the same bar.
      if ((e.target as HTMLElement).classList.contains('dev-close')) return
      const rect = this.root.getBoundingClientRect()
      dx = e.clientX - rect.left
      dy = e.clientY - rect.top
      addEventListener('pointermove', onMove)
      addEventListener('pointerup', onUp)
      e.preventDefault()
    })
  }

  toggle() {
    this.open = !this.open
    this.root.style.display = this.open ? '' : 'none'
  }

  /** Refresh the stats readout. Cheap enough to call every frame while open. */
  tick() {
    if (!this.open) return
    const s = this.actions.stats()
    this.statsLine.textContent =
      `${s.fps.toFixed(0)} fps · ${s.calls} calls · ${(s.tris / 1e6).toFixed(2)}M tris · ${s.quality}`
  }
}
