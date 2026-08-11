import {
  productInterval,
  productValue,
  type Animal,
  type Pasture,
} from '../game/animals'
import { Input } from '../core/input'
import { formatCoins } from './format'
import { coinIconHtml, iconHtml } from './icons'
import { backdropClickSwallowed } from '../core/click-guard'

/**
 * One animal's card: who it is, what it gives, and how long until it gives it.
 *
 * The paddock used to be twelve identical shapes with a bubble over the ones
 * worth walking to. Everything that made an animal an animal — that it has been
 * there since level five, that it is the best cow on the farm, that it fills
 * twice as fast as the other one — existed nowhere, because there was nothing
 * to click.
 *
 * The card is also where collecting happens now. Clicking a ready animal used
 * to pay out on the spot, which was fast and told the player nothing; the
 * button here keeps the one extra tap and puts the number, the grade and the
 * trait in front of them while they take it.
 */
export class AnimalInfoUi {
  private readonly root: HTMLDivElement
  private readonly body: HTMLDivElement
  private animal: Animal | null = null
  /** Last readiness painted onto the collect button — avoids rewriting it every frame. */
  private paintedReady: boolean | null = null

  open = false

  constructor(
    private readonly pasture: Pasture,
    private readonly onCollect: (animal: Animal) => void,
  ) {
    this.root = document.createElement('div')
    this.root.id = 'animalCard'
    this.root.className = 'hidden'
    this.root.innerHTML = `
      <div class="panel ac-panel">
        <header><h2 id="acTitle">Animal</h2><button id="acClose">✕</button></header>
        <div id="acBody"></div>
      </div>`
    document.getElementById('ui')!.appendChild(this.root)

    this.body = this.root.querySelector('#acBody')!
    this.root.querySelector('#acClose')!.addEventListener('click', () => this.close())
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root && !backdropClickSwallowed()) this.close()
    })
  }

  show(animal: Animal) {
    this.animal = animal
    this.open = true
    this.paintedReady = null
    this.root.classList.remove('hidden')
    Input.clear()
    this.render()
  }

  close() {
    this.open = false
    this.animal = null
    this.paintedReady = null
    this.root.classList.add('hidden')
    Input.clear()
  }

  /**
   * Keep the countdown moving while open — without rebuilding the DOM.
   *
   * A full `render()` every frame used to tear down the Collect button between
   * mousedown and mouseup, so the click never fired and the button looked dead.
   */
  tick() {
    if (!this.open || !this.animal) return
    // Sold, or the paddock was rebuilt from a save under it.
    if (!this.pasture.has(this.animal)) {
      this.close()
      return
    }
    this.updateLive()
  }

  private render() {
    const animal = this.animal
    if (!animal) return
    const { def, grade, trait } = animal
    const title = this.root.querySelector('#acTitle') as HTMLElement
    title.innerHTML = `${iconHtml(def.id, def.emoji, 'title-ico')} ${animal.name}`

    const value = productValue(animal)
    const interval = productInterval(animal)
    const remaining = Math.max(0, animal.timer)
    const progress = animal.ready ? 1 : Math.min(1, 1 - remaining / interval)

    this.body.innerHTML =
      `<div class="ac-head">
         <div class="ac-portrait" style="--grade:${grade.color}">${iconHtml(def.id, def.emoji, 'ac-portrait-ico')}</div>
         <div class="ac-ident">
           <div class="ac-grade" style="--grade:${grade.color}">${grade.emoji} ${grade.name} ${def.name}</div>
           <div class="ac-trait"><b>${trait.name}</b> — ${trait.blurb}</div>
         </div>
       </div>
       <div class="ac-stats">
         <div class="ac-stat"><span>Gives</span><b>${iconHtml(def.product.name.toLowerCase(), def.product.emoji, 'inline-ico')} ${def.product.name}</b></div>
         <div class="ac-stat"><span>Worth</span><b>${coinIconHtml('inline-ico')}${formatCoins(value)}${
           grade.value !== 1 || trait.value !== 1
             ? ` <i class="ac-mult">×${(grade.value * trait.value).toFixed(1)}</i>`
             : ''
         }</b></div>
         <div class="ac-stat"><span>Every</span><b>${fmt(interval)}${
           trait.speed !== 1 ? ` <i class="ac-mult">${trait.speed < 1 ? 'quicker' : 'slower'}</i>` : ''
         }</b></div>
       </div>
       <div class="ac-bar"><i style="width:${Math.round(progress * 100)}%"></i></div>
       <div class="ac-when">${animal.ready ? 'Ready to collect' : `Ready in ${fmt(remaining)}`}</div>`

    const collect = document.createElement('button')
    collect.className = 'buy'
    collect.dataset.acCollect = '1'
    collect.disabled = !animal.ready
    collect.innerHTML = animal.ready
      ? `${iconHtml('harvest', '🧺', 'inline-ico')} Collect ${def.product.name}`
      : 'Not ready yet'
    collect.addEventListener('click', () => {
      if (!this.animal?.ready) return
      this.onCollect(this.animal)
      this.paintedReady = null
      this.render()
    })
    this.body.appendChild(collect)
    this.paintedReady = animal.ready
  }

  /** Progress bar, countdown, and collect affordance — leaves the button node alone. */
  private updateLive() {
    const animal = this.animal
    if (!animal) return

    const interval = productInterval(animal)
    const remaining = Math.max(0, animal.timer)
    const progress = animal.ready ? 1 : Math.min(1, 1 - remaining / interval)

    const bar = this.body.querySelector('.ac-bar i') as HTMLElement | null
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`

    const when = this.body.querySelector('.ac-when') as HTMLElement | null
    if (when) {
      when.textContent = animal.ready ? 'Ready to collect' : `Ready in ${fmt(remaining)}`
    }

    if (this.paintedReady === animal.ready) return

    const collect = this.body.querySelector('[data-ac-collect]') as HTMLButtonElement | null
    if (!collect) return
    collect.disabled = !animal.ready
    collect.innerHTML = animal.ready
      ? `${iconHtml('harvest', '🧺', 'inline-ico')} Collect ${animal.def.product.name}`
      : 'Not ready yet'
    this.paintedReady = animal.ready
  }
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}
