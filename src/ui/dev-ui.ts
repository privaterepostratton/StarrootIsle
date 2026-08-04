/**
 * Developer panel. Backquote (`) toggles it; `?dev` in the URL opens it at
 * boot for touch devices with no backquote to press.
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

    const btn = (label: string, run: () => void) => {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', run)
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
    )

    this.statsLine = document.createElement('div')
    this.statsLine.className = 'dev-stats'
    this.root.append(this.statsLine)

    document.getElementById('ui')!.appendChild(this.root)

    if (new URLSearchParams(location.search).has('dev')) this.toggle()
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
