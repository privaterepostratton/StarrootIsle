import type { Audio } from '../core/audio'
import type { PostFX, QualityLevel } from '../core/postfx'
import { Input } from '../core/input'
import { iconHtml } from './icons'

/**
 * Settings panel.
 *
 * Persisted separately from the save file: a player who resets their farm
 * should not also lose their volume preference, and settings need to apply
 * before the world finishes loading.
 */

const KEY = 'sprout-valley-settings-v1'

export interface Settings {
  master: number
  music: number
  sfx: number
  muted: boolean
  /** 'auto' lets PostFX downgrade itself on slow hardware. */
  quality: QualityLevel | 'auto'
  shake: boolean
  showTips: boolean
}

const DEFAULTS: Settings = {
  master: 0.9,
  music: 0.16,
  sfx: 0.55,
  muted: false,
  quality: 'auto',
  shake: true,
  showTips: true,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Private browsing. Losing a preference is not worth an error path.
  }
}

export interface SettingsCallbacks {
  resetFarm(): void
}

export class SettingsUi {
  private readonly root: HTMLDivElement
  readonly settings: Settings

  open = false

  constructor(
    private readonly audio: Audio,
    private readonly postfx: PostFX,
    private readonly callbacks: SettingsCallbacks,
  ) {
    this.settings = loadSettings()

    this.root = document.createElement('div')
    this.root.id = 'settingsPanel'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel">
        <header><h2>${iconHtml('settings', '⚙️', 'title-ico')} Settings</h2><button id="settingsClose">✕</button></header>
        <div id="settingsBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.root.querySelector('#settingsClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close()
    })

    this.apply()
    this.render()
  }

  /** Push current settings into the systems they control. */
  apply() {
    const s = this.settings
    this.audio.setMasterVolume(s.master)
    this.audio.setMusicVolume(s.music)
    this.audio.setSfxVolume(s.sfx)
    this.audio.setMuted(s.muted)
    if (s.quality !== 'auto') this.postfx.setQuality(s.quality)
    this.postfx.autoQuality = s.quality === 'auto'
  }

  private commit() {
    this.apply()
    saveSettings(this.settings)
  }

  toggle() {
    this.open ? this.close() : this.show()
  }

  show() {
    this.open = true
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
  }

  close() {
    this.open = false
    this.root.classList.add('hidden')
    Input.clear()
  }

  private slider(label: string, value: number, onInput: (v: number) => void) {
    const row = document.createElement('div')
    row.className = 'setting-row'
    row.innerHTML = `<span class="setting-label">${label}</span>`

    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '100'
    input.value = String(Math.round(value * 100))
    input.className = 'setting-slider'

    const readout = document.createElement('span')
    readout.className = 'setting-value'
    readout.textContent = `${Math.round(value * 100)}%`

    input.addEventListener('input', () => {
      const v = Number(input.value) / 100
      readout.textContent = `${input.value}%`
      onInput(v)
      this.commit()
    })

    row.appendChild(input)
    row.appendChild(readout)
    return row
  }

  private toggleRow(label: string, on: boolean, onChange: (v: boolean) => void) {
    const row = document.createElement('div')
    row.className = 'setting-row'
    row.innerHTML = `<span class="setting-label">${label}</span>`

    const btn = document.createElement('button')
    btn.className = `setting-toggle${on ? ' on' : ''}`
    btn.textContent = on ? 'On' : 'Off'
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('on')
      btn.classList.toggle('on', next)
      btn.textContent = next ? 'On' : 'Off'
      onChange(next)
      this.commit()
    })

    row.appendChild(btn)
    return row
  }

  private render() {
    const body = this.root.querySelector('#settingsBody') as HTMLDivElement
    body.innerHTML = ''
    const s = this.settings

    const audioHeading = document.createElement('h3')
    audioHeading.className = 'journal-heading'
    audioHeading.textContent = 'Audio'
    body.appendChild(audioHeading)

    body.appendChild(this.toggleRow('Sound', !s.muted, (v) => (s.muted = !v)))
    body.appendChild(this.slider('Master', s.master, (v) => (s.master = v)))
    body.appendChild(this.slider('Music', s.music, (v) => (s.music = v)))
    body.appendChild(this.slider('Effects', s.sfx, (v) => (s.sfx = v)))

    const gfxHeading = document.createElement('h3')
    gfxHeading.className = 'journal-heading'
    gfxHeading.textContent = 'Graphics'
    body.appendChild(gfxHeading)

    const qualityRow = document.createElement('div')
    qualityRow.className = 'setting-row'
    qualityRow.innerHTML = `<span class="setting-label">Quality</span>`
    const group = document.createElement('div')
    group.className = 'setting-group'
    for (const level of ['auto', 'high', 'medium', 'low'] as const) {
      const btn = document.createElement('button')
      btn.className = `setting-chip${s.quality === level ? ' on' : ''}`
      btn.textContent = level[0].toUpperCase() + level.slice(1)
      btn.addEventListener('click', () => {
        s.quality = level
        for (const b of group.children) b.classList.remove('on')
        btn.classList.add('on')
        this.commit()
      })
      group.appendChild(btn)
    }
    qualityRow.appendChild(group)
    body.appendChild(qualityRow)

    body.appendChild(this.toggleRow('Screen shake', s.shake, (v) => (s.shake = v)))

    const gameHeading = document.createElement('h3')
    gameHeading.className = 'journal-heading'
    gameHeading.textContent = 'Game'
    body.appendChild(gameHeading)

    body.appendChild(this.toggleRow('Show tips', s.showTips, (v) => (s.showTips = v)))

    // Reset is deliberately two clicks — it destroys hours of progress and a
    // stray click on a settings panel should never be able to do that.
    const resetRow = document.createElement('div')
    resetRow.className = 'setting-row'
    resetRow.innerHTML = `<span class="setting-label">Start over</span>`
    const reset = document.createElement('button')
    reset.className = 'setting-danger'
    reset.textContent = 'Reset farm'
    let armed = false
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true
        reset.textContent = 'Really? Click again'
        reset.classList.add('armed')
        setTimeout(() => {
          armed = false
          reset.textContent = 'Reset farm'
          reset.classList.remove('armed')
        }, 4000)
        return
      }
      this.callbacks.resetFarm()
    })
    resetRow.appendChild(reset)
    body.appendChild(resetRow)

    const controls = document.createElement('div')
    controls.className = 'setting-controls'
    controls.innerHTML = `
      <h3 class="journal-heading">Controls</h3>
      <div><b>WASD</b> move · <b>Right-drag</b> look · <b>Wheel</b> zoom</div>
      <div><b>Click</b> a plot to open it · <b>E</b> interact</div>
      <div><b>H</b> harvest all · <b>B</b> shovel · <b>V</b> sprinkler</div>
      <div><b>J</b> journal · <b>N</b> valley · <b>P</b> pets · <b>1–9</b> seeds</div>
      <div><b>Q</b>/<b>R</b> rotate camera · <b>M</b> mute · <b>O</b> settings · <b>Esc</b> close</div>`
    body.appendChild(controls)
  }
}
